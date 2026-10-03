# volatility.py
"""
Are option premiums rich or thin right now?

Covered calls earn the most when options are priced for bigger moves than
the stock actually makes. This compares:

  implied volatility — what near-the-money options in your expiry window are
                       priced for (median of their impliedVolatility)
  realized volatility — how much the stock has actually moved over the last
                        20 trading days (annualized, from daily closes)

  rich   — implied ≥ 1.25 × realized: a good time to sell
  normal — in between
  thin   — implied < realized: options pay less than the risk you take; waiting may pay more
"""
from __future__ import annotations

import math

import pandas as pd

from core.market_data import get_recent_closes

RICH_RATIO = 1.25
THIN_RATIO = 1.0
WINDOW = 20                 # trading days of history for realized volatility
NEAR_MONEY = 0.10           # options within 10% of the stock price
VALID_IV = (0.05, 3.0)      # Yahoo sometimes reports junk IVs (e.g. outside market hours)


def realized_volatility(closes: list[float], window: int = WINDOW) -> float | None:
    closes = [c for c in closes if c and c > 0]
    if len(closes) < window + 1:
        return None
    recent = closes[-(window + 1):]
    returns = [math.log(b / a) for a, b in zip(recent[:-1], recent[1:], strict=True)]
    mean = sum(returns) / len(returns)
    var = sum((r - mean) ** 2 for r in returns) / (len(returns) - 1)
    return math.sqrt(var) * math.sqrt(252)


def implied_volatility_near_money(calls: pd.DataFrame, stock_price: float) -> float | None:
    if calls is None or calls.empty or "impliedVolatility" not in calls.columns or not stock_price:
        return None
    iv = pd.to_numeric(calls["impliedVolatility"], errors="coerce")
    strike = pd.to_numeric(calls["strike"], errors="coerce")
    near = (strike - stock_price).abs() <= stock_price * NEAR_MONEY
    valid = iv.between(*VALID_IV)
    picked = iv[near & valid]
    return float(picked.median()) if not picked.empty else None


def premium_check(ticker: str, calls: pd.DataFrame, stock_price: float) -> dict | None:
    """{"level": "rich"|"normal"|"thin", "implied_vol", "realized_vol"}, or None without enough data."""
    iv = implied_volatility_near_money(calls, stock_price)
    rv = realized_volatility(get_recent_closes(ticker) or [])
    if iv is None or not rv:
        return None
    ratio = iv / rv
    level = "rich" if ratio >= RICH_RATIO else "thin" if ratio < THIN_RATIO else "normal"
    return {"level": level, "implied_vol": round(iv, 4), "realized_vol": round(rv, 4)}
