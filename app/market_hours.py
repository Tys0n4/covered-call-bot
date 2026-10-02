# market_hours.py
"""
Regular US options trading hours: Monday–Friday, 9:30am–4:00pm New York time.
Market holidays aren't listed here; the scanner also switches to last prices
whenever Yahoo returns no live quotes at all, which covers holidays.
"""
from __future__ import annotations

from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

NEW_YORK = ZoneInfo("America/New_York")
OPEN, CLOSE = time(9, 30), time(16, 0)


def _ny(now: datetime | None) -> datetime:
    return (now or datetime.now(NEW_YORK)).astimezone(NEW_YORK)


def is_market_open(now: datetime | None = None) -> bool:
    n = _ny(now)
    return n.weekday() < 5 and OPEN <= n.time() < CLOSE


def next_market_open(now: datetime | None = None) -> datetime:
    """The next weekday 9:30am New York time (today's, if it hasn't happened yet)."""
    n = _ny(now)
    day = n.date()
    if n.weekday() >= 5 or n.time() >= OPEN:
        day += timedelta(days=1)
    while day.weekday() >= 5:
        day += timedelta(days=1)
    return datetime.combine(day, OPEN, tzinfo=NEW_YORK)
