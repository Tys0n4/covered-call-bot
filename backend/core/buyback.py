# buyback.py
from __future__ import annotations

import logging
from datetime import date
from decimal import ROUND_HALF_DOWN, Decimal

import pandas as pd

from core.options_data import get_calls
from core.quotes import select_quote, QuoteMode
from core.models import OpenCoveredCall
from core.config import ScannerConfig, DEFAULT_CONFIG
from core.fees import typical_fee_per_contract
from core.market_data import get_current_price, get_dividend_amount, get_events
from core.events import fed_meetings_between
from core.market_hours import NEW_YORK, last_session, market_today, previous_trading_day
from core.parallel import parallel_map

log = logging.getLogger(__name__)

CENT = Decimal("0.01")


def _trade_day(value) -> date | None:
    """Yahoo's lastTradeDate as a New York date."""
    try:
        ts = pd.to_datetime(value, utc=True)
    except (ValueError, TypeError):
        return None
    return None if pd.isna(ts) else ts.tz_convert(NEW_YORK).date()


def get_current_option_quote(
    ticker: str,
    expiry: str,
    strike: float,
    *,
    mode: QuoteMode = "mid_or_ask",
    strike_tolerance: float = DEFAULT_CONFIG.strike_match_tolerance,
) -> dict:
    """
    {"price", "old_trade_date", "source"} for an open call: what buying it back
    costs, at the midpoint by default, where buy orders usually fill (the ask
    when there's no bid). Chains are cached briefly (options_data.get_calls), so
    positions on the same expiry share one download. Without a bid or ask the
    last trade is used, unless it's from before the latest session: a quiet
    strike's trade from days ago was at a different stock price, so then
    price is 0 (no recommendation) and old_trade_date says when it last traded.
    """
    calls = get_calls(ticker, expiry)
    if calls is None or calls.empty or "strike" not in calls.columns:
        return {"price": 0.0, "old_trade_date": None, "source": None}
    calls = calls.copy()
    calls["strike"] = calls["strike"].astype(float)
    calls["_diff"] = (calls["strike"] - float(strike)).abs()
    row = calls.sort_values("_diff").iloc[0]
    source = row.get("source")
    if float(row["_diff"]) > float(strike_tolerance):
        return {"price": 0.0, "old_trade_date": None, "source": source}

    result = select_quote(bid=row.get("bid"), ask=row.get("ask"), last_price=row.get("lastPrice"), mode=mode)
    if result.source == "LAST":
        traded = _trade_day(row.get("lastTradeDate"))
        if traded and traded < last_session():
            return {"price": 0.0, "old_trade_date": traded.isoformat(), "source": source}
    return {"price": result.price, "old_trade_date": None, "source": source}


def buyback_price(entry_price: float, target_pct: float) -> float:
    """
    The price per share to buy back at for a target share of premium kept:
    what you sold for × (1 − target), rounded to the closest cent, since options
    trade in whole cents. Half a cent rounds down (you keep more). At least $0.01.

      sold at $0.34, 85% → $0.051 → $0.05 (85.3% kept)
      sold at $0.38, 85% → $0.057 → $0.06 (84.2% kept: closer than $0.05)
    """
    if entry_price <= 0:
        return 0.0
    raw = Decimal(str(entry_price)) * (Decimal(100) - Decimal(str(target_pct))) / 100
    return max(float(raw.quantize(CENT, rounding=ROUND_HALF_DOWN)), 0.01)


def calculate_profit_capture(entry_price: float, current_price: float) -> float:
    if entry_price <= 0:
        return 0.0
    return ((entry_price - current_price) / entry_price) * 100


def evaluate_position(
    position: dict,
    current_option_price: float,
    config: ScannerConfig = DEFAULT_CONFIG,
    *,
    stock_price: float | None = None,
    fee_per_contract: float = 0.0,
    today: str | None = None,
    event: dict | None = None,
) -> OpenCoveredCall:
    """
    Recommend an action for one open call:
      buy_back   — the call costs no more than your buy-back price (your target
                   share of the premium kept, at the closest cent); when
                   earnings or a Fed meeting comes before expiry (event), the
                   lower event target applies, to avoid holding through the jump
      let_expire — past the target, but it expires within a week with the stock
                   well below the strike and no event in between: buying back would
                   mostly pay the spread and commission for very little risk removed
      hold       — not at the target yet (or no price to judge by)
    """
    entry_price = float(position["entry_price"])
    contracts = int(position["contracts"])
    strike = float(position["strike"])
    days_left = (date.fromisoformat(position["expiry"]) - date.fromisoformat(today or market_today())).days

    target = config.profit_capture_target_pct
    if event:
        target = min(target, config.event_buyback_pct)

    limit = buyback_price(entry_price, target)

    profit_capture = 0.0
    action = "hold"
    if current_option_price > 0:
        # (With no price, don't treat the call as worth $0 = 100% kept.)
        profit_capture = calculate_profit_capture(entry_price, current_option_price)
        if current_option_price <= limit + 1e-9:
            far_below = bool(stock_price) and strike >= stock_price * (1 + config.let_expire_cushion)
            quiet = event is None
            action = "let_expire" if quiet and days_left <= config.let_expire_days and far_below else "buy_back"

    return OpenCoveredCall(
        ticker=position["ticker"],
        expiry=position["expiry"],
        strike=strike,
        contracts=contracts,
        entry_price=entry_price,
        current_option_price=current_option_price,
        profit_capture_pct=round(profit_capture, 2),
        should_buy_back=action == "buy_back",
        action=action,
        days_left=days_left,
        stock_price=stock_price,
        cost_to_close=round(current_option_price * contracts * 100 + fee_per_contract * contracts, 2),
        target_pct=target,
        buyback_price=limit,
        buyback_kept_pct=round(calculate_profit_capture(entry_price, limit), 1),
        event=event,
    )


def early_exercise_risk(
    strike: float,
    stock_price: float | None,
    option_price: float,
    expiry: str,
    ex_dividend_date: str | None,
    dividend: float | None,
    today: str,
) -> dict | None:
    """
    A call in the money is often exercised early, on the trading day before the
    stock goes ex-dividend, when its time value (price − (stock − strike)) is
    less than the dividend: the buyer collects the dividend and gives up less
    than that in time value. Then you'd lose the shares weeks before expiry.

    {"ex_dividend_date", "dividend", "time_value", "exercise_by"} or None.
    """
    if not (ex_dividend_date and dividend and stock_price and option_price > 0):
        return None
    if not (today < ex_dividend_date <= expiry) or stock_price <= strike:
        return None
    time_value = option_price - (stock_price - strike)
    if time_value >= dividend:
        return None
    return {
        "ex_dividend_date": ex_dividend_date,
        "dividend": round(dividend, 2),
        "time_value": round(max(time_value, 0.0), 2),
        "exercise_by": previous_trading_day(ex_dividend_date),
    }


def next_event(ticker: str, expiry: str, today: str | None = None) -> dict | None:
    """The first earnings or Fed decision from today until expiry: {"kind", "date"}, or None."""
    today = today or market_today()
    found = []
    earnings = get_events(ticker).get("earnings_date")
    if earnings and today <= earnings <= expiry:
        found.append({"kind": "earnings", "date": earnings})
    found += [{"kind": "fed", "date": d} for d in fed_meetings_between(today, expiry)]
    return min(found, key=lambda e: e["date"]) if found else None


def evaluate_positions(
    positions: list[dict],
    config: ScannerConfig = DEFAULT_CONFIG,
    price_mode: QuoteMode = "mid_or_ask",
) -> list[OpenCoveredCall]:
    """
    Batch evaluate open positions: what buying each call back costs now (the
    midpoint, see get_current_option_quote), the stock price, and your usual
    commission. One result per position, in the same order.

    Stocks are fetched side by side (core/parallel.py): first each stock's
    price, which also downloads its Cboe chain, then each call. Calls on the
    same stock share one download through the cache.
    """
    fee = typical_fee_per_contract()
    tickers = list(dict.fromkeys(pos["ticker"] for pos in positions))
    stock_prices = dict(zip(tickers, parallel_map(get_current_price, tickers), strict=True))

    def check(pos: dict) -> OpenCoveredCall:
        log.debug("Checking %s %s $%.2f", pos["ticker"], pos["expiry"], float(pos["strike"]))
        quote = get_current_option_quote(
            ticker=pos["ticker"],
            expiry=pos["expiry"],
            strike=float(pos["strike"]),
            mode=price_mode,
            strike_tolerance=config.strike_match_tolerance,
        )
        result = evaluate_position(pos, quote["price"], config=config,
                                   stock_price=stock_prices[pos["ticker"]], fee_per_contract=fee,
                                   event=next_event(pos["ticker"], pos["expiry"]))
        result.old_trade_date = quote["old_trade_date"]
        result.price_source = quote["source"]
        # Only in the money, with an ex-dividend date ahead, is the dividend worth looking up
        stock = stock_prices[pos["ticker"]]
        ex_div = get_events(pos["ticker"]).get("ex_dividend_date") if stock and stock > result.strike else None
        if ex_div:
            result.early_exercise = early_exercise_risk(
                result.strike, stock, result.current_option_price, result.expiry, ex_div,
                get_dividend_amount(pos["ticker"]), market_today(),
            )
        return result

    return parallel_map(check, positions)
