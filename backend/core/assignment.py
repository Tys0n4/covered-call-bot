# assignment.py
"""
Finds expired calls that probably got assigned: the stock closed above the
strike on expiry day, so the buyer most likely exercised and your shares were
sold. The app asks you to confirm instead of assuming, because only your
broker knows for sure.
"""
from __future__ import annotations

from datetime import date, timedelta

from core.market_data import get_close_on
from core.market_hours import market_today
from core.parallel import parallel_map
from core.positions import expired_unreviewed

REVIEW_DAYS = 45   # only look at calls that expired within this many days


def calls_to_review() -> list[dict]:
    since = (date.fromisoformat(market_today()) - timedelta(days=REVIEW_DAYS)).isoformat()
    calls = expired_unreviewed(since)
    closes = parallel_map(lambda p: get_close_on(p["ticker"], p["expiry"]), calls)
    return [
        {**p, "close_price": round(close, 2)}
        for p, close in zip(calls, closes, strict=True)
        if close is not None and close > float(p["strike"])
    ]
