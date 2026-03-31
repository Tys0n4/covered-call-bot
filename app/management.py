# management.py
from __future__ import annotations

from typing import Literal

import yfinance as yf


def calculate_profit_capture(entry_price, current_price):
    if entry_price <= 0:
        return 0.0
    return ((entry_price - current_price) / entry_price) * 100


def should_buy_back(entry_price, current_price, target_profit_pct=80):
    profit_capture = calculate_profit_capture(entry_price, current_price)
    return profit_capture >= target_profit_pct


def evaluate_position(position, current_option_price, target_profit_pct=80):
    entry_price = position["entry_price"]
    profit_capture = calculate_profit_capture(entry_price, current_option_price)
    buy_back = should_buy_back(entry_price, current_option_price, target_profit_pct)

    return {
        "ticker": position["ticker"],
        "expiry": position["expiry"],
        "strike": position["strike"],
        "contracts": position["contracts"],
        "entry_price": entry_price,
        "current_option_price": current_option_price,
        "profit_capture_pct": round(profit_capture, 2),
        "should_buy_back": buy_back,
    }


def get_current_option_price(
    ticker: str,
    expiry: str,
    strike: float,
    *,
    mode: Literal["mid_or_last", "ask", "bid"] = "mid_or_last",
    strike_tolerance: float = 0.01,
) -> float:
    """
    Fetch current option price from yfinance for (expiry, strike).

    mode:
      - mid_or_last: midpoint if bid+ask valid else lastPrice else 0
      - ask: ask if >0 else lastPrice else 0 (more conservative for buybacks)
      - bid: bid if >0 else lastPrice else 0
    """
    tk = yf.Ticker(ticker)
    chain = tk.option_chain(expiry)
    calls = chain.calls.copy()

    if calls.empty or "strike" not in calls.columns:
        return 0.0

    calls["strike"] = calls["strike"].astype(float)
    target = float(strike)

    calls["strike_diff"] = (calls["strike"] - target).abs()
    row = calls.sort_values("strike_diff").iloc[0]

    if float(row["strike_diff"]) > float(strike_tolerance):
        return 0.0

    bid = float(row.get("bid") or 0.0)
    ask = float(row.get("ask") or 0.0)
    last_price = float(row.get("lastPrice") or 0.0)

    if mode == "ask":
        if ask > 0:
            return ask
        return last_price if last_price > 0 else 0.0

    if mode == "bid":
        if bid > 0:
            return bid
        return last_price if last_price > 0 else 0.0

    # default: mid_or_last
    if bid > 0 and ask > 0 and ask >= bid:
        return (bid + ask) / 2.0
    if last_price > 0:
        return last_price
    return 0.0


def evaluate_positions(
    positions: list[dict],
    *,
    target_profit_pct: float = 80.0,
    price_mode: Literal["mid_or_last", "ask", "bid"] = "mid_or_last",
) -> list[dict]:
    """
    Batch evaluate open positions: fetch current option prices + compute buyback flags.
    Returns list of evaluate_position() dicts.
    """
    results: list[dict] = []
    for pos in positions:
        current_px = get_current_option_price(
            ticker=pos["ticker"],
            expiry=pos["expiry"],
            strike=float(pos["strike"]),
            mode=price_mode,
        )
        results.append(
            evaluate_position(
                position=pos,
                current_option_price=current_px,
                target_profit_pct=target_profit_pct,
            )
        )
    return results