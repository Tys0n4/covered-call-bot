# buyback.py
from __future__ import annotations

import logging

from core.options_data import get_calls
from core.quotes import select_quote, QuoteMode
from core.models import OpenCoveredCall
from core.config import ScannerConfig, DEFAULT_CONFIG

log = logging.getLogger(__name__)


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


def calculate_profit_capture(entry_price: float, current_price: float) -> float:
    if entry_price <= 0:
        return 0.0
    return ((entry_price - current_price) / entry_price) * 100


def evaluate_position(
    position: dict,
    current_option_price: float,
    config: ScannerConfig = DEFAULT_CONFIG,
) -> OpenCoveredCall:
    entry_price = float(position["entry_price"])
    if current_option_price <= 0:
        # No price came back (no quote, or the chain couldn't be fetched).
        # Don't treat that as "worth $0 = 100% kept"; just don't recommend anything.
        profit_capture = 0.0
        buy_back = False
    else:
        profit_capture = calculate_profit_capture(entry_price, current_option_price)
        buy_back = profit_capture >= config.profit_capture_target_pct

    return OpenCoveredCall(
        ticker=position["ticker"],
        expiry=position["expiry"],
        strike=float(position["strike"]),
        contracts=int(position["contracts"]),
        entry_price=entry_price,
        current_option_price=current_option_price,
        profit_capture_pct=round(profit_capture, 2),
        should_buy_back=buy_back,
    )


def evaluate_positions(
    positions: list[dict],
    config: ScannerConfig = DEFAULT_CONFIG,
    price_mode: QuoteMode = "ask",
) -> list[OpenCoveredCall]:
    """
    Batch evaluate open positions.
    Fetches current ask price for each and computes buyback recommendation.
    """
    results: list[OpenCoveredCall] = []

    for pos in positions:
        log.debug("Checking %s %s $%.2f", pos["ticker"], pos["expiry"], float(pos["strike"]))
        current_px = get_current_option_price(
            ticker=pos["ticker"],
            expiry=pos["expiry"],
            strike=float(pos["strike"]),
            mode=price_mode,
            strike_tolerance=config.strike_match_tolerance,
        )
        results.append(evaluate_position(pos, current_px, config=config))

    return results
