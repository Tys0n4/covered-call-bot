# management.py
from __future__ import annotations

import yfinance as yf

from quote_policy import select_quote, QuoteMode
from models import OpenCoveredCall
from config import ScannerConfig, DEFAULT_CONFIG


# ---------------------------------------------------------------------------
# Price fetching
# ---------------------------------------------------------------------------

def get_current_option_price(
    ticker: str,
    expiry: str,
    strike: float,
    *,
    mode: QuoteMode = "mid_or_last",
    strike_tolerance: float = DEFAULT_CONFIG.strike_match_tolerance,
) -> float:
    """
    Fetch the current market price for an open call position.
    Delegates quote selection to quote_policy.select_quote for consistency.
    """
    tk = yf.Ticker(ticker)
    chain = tk.option_chain(expiry)
    calls = chain.calls.copy()

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


# ---------------------------------------------------------------------------
# Evaluation logic
# ---------------------------------------------------------------------------

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
    *,
    config: ScannerConfig = DEFAULT_CONFIG,
    price_mode: QuoteMode = "mid_or_last",
) -> list[OpenCoveredCall]:
    """Batch evaluate open positions: fetch current prices and compute buyback flags."""
    results: list[OpenCoveredCall] = []
    for pos in positions:
        current_px = get_current_option_price(
            ticker=pos["ticker"],
            expiry=pos["expiry"],
            strike=float(pos["strike"]),
            mode=price_mode,
            strike_tolerance=config.strike_match_tolerance,
        )
        results.append(evaluate_position(pos, current_px, config=config))
    return results
