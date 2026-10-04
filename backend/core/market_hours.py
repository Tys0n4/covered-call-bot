# market_hours.py
"""
Regular US options trading hours: Monday–Friday, 9:30am–4:00pm New York time,
except NYSE holidays (closed) and early-close days (1:00pm).

The scanner also switches to last prices whenever Yahoo returns no live
quotes at all, as a backstop if this calendar ever misses a closure.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta
from functools import lru_cache
from zoneinfo import ZoneInfo

NEW_YORK = ZoneInfo("America/New_York")
OPEN, CLOSE, EARLY_CLOSE = time(9, 30), time(16, 0), time(13, 0)


def _ny(now: datetime | None) -> datetime:
    return (now or datetime.now(NEW_YORK)).astimezone(NEW_YORK)


# ---------------------------------------------------------------------------
# NYSE calendar

def _easter(year: int) -> date:
    """Easter Sunday (Anonymous Gregorian algorithm)."""
    a, b, c = year % 19, year // 100, year % 100
    d, e = b // 4, b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7  # noqa: E741
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31
    day = (h + l - 7 * m + 114) % 31 + 1
    return date(year, month, day)


def _nth_weekday(year: int, month: int, weekday: int, n: int) -> date:
    """n-th weekday (Mon=0) of a month; n=-1 for the last one."""
    if n > 0:
        first = date(year, month, 1)
        return first + timedelta(days=(weekday - first.weekday()) % 7 + 7 * (n - 1))
    last = date(year + (month == 12), month % 12 + 1, 1) - timedelta(days=1)
    return last - timedelta(days=(last.weekday() - weekday) % 7)


def _observed(d: date) -> date:
    """Saturday holidays are observed Friday, Sunday holidays Monday."""
    if d.weekday() == 5:
        return d - timedelta(days=1)
    if d.weekday() == 6:
        return d + timedelta(days=1)
    return d


@lru_cache(maxsize=32)
def nyse_holidays(year: int) -> frozenset[date]:
    days = {
        _nth_weekday(year, 1, 0, 3),               # Martin Luther King Jr. Day
        _nth_weekday(year, 2, 0, 3),               # Presidents' Day
        _easter(year) - timedelta(days=2),         # Good Friday
        _nth_weekday(year, 5, 0, -1),              # Memorial Day
        _observed(date(year, 7, 4)),               # Independence Day
        _nth_weekday(year, 9, 0, 1),               # Labor Day
        _nth_weekday(year, 11, 3, 4),              # Thanksgiving
        _observed(date(year, 12, 25)),             # Christmas
    }
    # New Year's Day: a Saturday one is not moved back into December
    new_year = date(year, 1, 1)
    if new_year.weekday() != 5:
        days.add(_observed(new_year))
    if year >= 2022:
        days.add(_observed(date(year, 6, 19)))     # Juneteenth
    return frozenset(days)


@lru_cache(maxsize=32)
def nyse_early_closes(year: int) -> frozenset[date]:
    """Days the market closes at 1:00pm New York time."""
    days = {_nth_weekday(year, 11, 3, 4) + timedelta(days=1)}   # day after Thanksgiving
    july3 = date(year, 7, 3)
    if july3.weekday() < 4:                                     # July 4th falls Tue–Fri
        days.add(july3)
    dec24 = date(year, 12, 24)
    if dec24.weekday() < 5 and dec24 not in nyse_holidays(year):
        days.add(dec24)
    return frozenset(days)


def is_trading_day(d: date) -> bool:
    return d.weekday() < 5 and d not in nyse_holidays(d.year)


def close_time(d: date) -> time:
    """When regular trading ends on a trading day."""
    return EARLY_CLOSE if d in nyse_early_closes(d.year) else CLOSE


# ---------------------------------------------------------------------------

def is_market_open(now: datetime | None = None) -> bool:
    n = _ny(now)
    return is_trading_day(n.date()) and OPEN <= n.time() < close_time(n.date())


def market_today(now: datetime | None = None) -> str:
    """Today's date in New York (the market's calendar), as YYYY-MM-DD."""
    return _ny(now).strftime("%Y-%m-%d")


def last_session(now: datetime | None = None) -> date:
    """The latest trading day whose session has started (today once it opens, else the one before)."""
    n = _ny(now)
    day = n.date()
    if not is_trading_day(day) or n.time() < OPEN:
        day -= timedelta(days=1)
        while not is_trading_day(day):
            day -= timedelta(days=1)
    return day


def has_expired(expiry: str, now: datetime | None = None) -> bool:
    """Options stop trading at the close (4:00pm, or 1:00pm on early-close days) on their expiry date."""
    n = _ny(now)
    today = n.strftime("%Y-%m-%d")
    return expiry < today or (expiry == today and n.time() >= close_time(n.date()))


def next_market_open(now: datetime | None = None) -> datetime:
    """The next trading day's 9:30am New York time (today's, if it hasn't happened yet)."""
    n = _ny(now)
    day = n.date()
    if not is_trading_day(day) or n.time() >= OPEN:
        day += timedelta(days=1)
    while not is_trading_day(day):
        day += timedelta(days=1)
    return datetime.combine(day, OPEN, tzinfo=NEW_YORK)
