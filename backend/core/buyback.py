# buyback.py
from __future__ import annotations

import logging
from datetime import date
from decimal import ROUND_HALF_DOWN, Decimal

from core.options_data import get_calls
from core.quotes import select_quote, QuoteMode
from core.models import OpenCoveredCall
from core.config import ScannerConfig, DEFAULT_CONFIG
from core.fees import typical_fee_per_contract
from core.market_data import get_current_price, get_events
from core.events import fed_meetings_between
from core.market_hours import market_today

log = logging.getLogger(__name__)

CENT = Decimal("0.01")


def get_current_option_price(
    ticker: str,
    expiry: str,
    strike: float,
    *,
    mode: QuoteMode = "ask",   # use ask for buybacks — more conservative cost estimate
    strike_tolerance: float = DEFAULT_CONFIG.strike_match_tolerance,
) -> float:
    """
    Fetch current market price for an open call position via yfinance.
    Uses ask price by default for buyback cost estimates (conservative).
    Delegates quote selection to quotes.py for consistency.
    Chains are cached briefly (options_data.get_calls), so positions on the
    same expiry share one download.
    """
    calls = get_calls(ticker, expiry)
    if calls is None:
        return 0.0
    calls = calls.copy()

    if calls.empty or "strike" not in calls.columns:
        return 0.0

    calls["strike"] = calls["strike"].astype(float)
    calls["_diff"] = (calls["strike"] - float(strike)).abs()
    row = calls.sort_values("_diff").iloc[0]

    if float(row["_diff"]) > float(strike_tolerance):
        return 0.0

    result = select_quote(
        bid=row.get("bid"),
        ask=row.get("ask"),
        last_price=row.get("lastPrice"),
        mode=mode,
    )
    return result.price


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
    price_mode: QuoteMode = "ask",
) -> list[OpenCoveredCall]:
    """
    Batch evaluate open positions: current ask for each call (a buyback pays
    the ask), the stock price, and your usual commission.
    """
    results: list[OpenCoveredCall] = []
    fee = typical_fee_per_contract()
    stock_prices: dict[str, float | None] = {}

    for pos in positions:
        log.debug("Checking %s %s $%.2f", pos["ticker"], pos["expiry"], float(pos["strike"]))
        current_px = get_current_option_price(
            ticker=pos["ticker"],
            expiry=pos["expiry"],
            strike=float(pos["strike"]),
            mode=price_mode,
            strike_tolerance=config.strike_match_tolerance,
        )
        if pos["ticker"] not in stock_prices:
            stock_prices[pos["ticker"]] = get_current_price(pos["ticker"])
        results.append(evaluate_position(pos, current_px, config=config,
                                         stock_price=stock_prices[pos["ticker"]], fee_per_contract=fee,
                                         event=next_event(pos["ticker"], pos["expiry"])))

    return results
