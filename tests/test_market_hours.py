# tests/test_market_hours.py — NYSE calendar
from datetime import date, datetime

import pytest

from core.market_hours import (
    NEW_YORK, has_expired, is_market_open, next_market_open, nyse_early_closes, nyse_holidays,
)


def ny(*args):
    return datetime(*args, tzinfo=NEW_YORK)


# Published NYSE holiday calendars
@pytest.mark.parametrize("year, expected", [
    (2024, ["2024-01-01", "2024-01-15", "2024-02-19", "2024-03-29", "2024-05-27", "2024-06-19",
            "2024-07-04", "2024-09-02", "2024-11-28", "2024-12-25"]),
    (2025, ["2025-01-01", "2025-01-20", "2025-02-17", "2025-04-18", "2025-05-26", "2025-06-19",
            "2025-07-04", "2025-09-01", "2025-11-27", "2025-12-25"]),
    (2026, ["2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19",
            "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25"]),
    (2027, ["2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18",
            "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24"]),
])
def test_holidays(year, expected):
    assert sorted(d.isoformat() for d in nyse_holidays(year)) == expected


def test_saturday_new_year_is_not_moved_back():
    # Jan 1, 2022 was a Saturday; NYSE stayed open Friday Dec 31, 2021
    assert date(2021, 12, 31) not in nyse_holidays(2021)
    assert date(2021, 12, 31) not in nyse_holidays(2022)


@pytest.mark.parametrize("year, expected", [
    (2024, ["2024-07-03", "2024-11-29", "2024-12-24"]),
    (2025, ["2025-07-03", "2025-11-28", "2025-12-24"]),
    (2026, ["2026-11-27", "2026-12-24"]),
])
def test_early_closes(year, expected):
    assert sorted(d.isoformat() for d in nyse_early_closes(year)) == expected


def test_market_closed_on_holiday_and_after_early_close():
    assert not is_market_open(ny(2025, 12, 25, 11, 0))      # Christmas
    assert is_market_open(ny(2025, 12, 24, 12, 59))         # early close day, before 1pm
    assert not is_market_open(ny(2025, 12, 24, 13, 0))
    assert is_market_open(ny(2025, 12, 23, 15, 59))
    assert not is_market_open(ny(2025, 12, 27, 11, 0))      # Saturday


def test_expiry_on_early_close_day_ends_at_1pm():
    assert not has_expired("2025-11-28", ny(2025, 11, 28, 12, 30))
    assert has_expired("2025-11-28", ny(2025, 11, 28, 13, 0))
    assert not has_expired("2025-11-26", ny(2025, 11, 26, 15, 59))
    assert has_expired("2025-11-26", ny(2025, 11, 26, 16, 0))


def test_next_open_skips_weekends_and_holidays():
    # Wednesday before Thanksgiving, after the close -> Friday (Thursday is a holiday)
    assert next_market_open(ny(2025, 11, 26, 17, 0)) == ny(2025, 11, 28, 9, 30)
    # Good Friday 2026 (Apr 3) -> Monday Apr 6
    assert next_market_open(ny(2026, 4, 2, 18, 0)) == ny(2026, 4, 6, 9, 30)
    # Before the open on a trading day -> same day
    assert next_market_open(ny(2026, 4, 6, 8, 0)) == ny(2026, 4, 6, 9, 30)


def test_delayed_quotes_catch_up_15_minutes_after_the_open():
    from core.market_hours import delayed_quotes_live, quotes_live_at
    assert not delayed_quotes_live(ny(2025, 12, 23, 9, 35))         # open, but quotes still show yesterday
    assert quotes_live_at(ny(2025, 12, 23, 9, 35)) == ny(2025, 12, 23, 9, 45)
    assert delayed_quotes_live(ny(2025, 12, 23, 9, 45))
    assert quotes_live_at(ny(2025, 12, 23, 9, 45)) is None
    assert delayed_quotes_live(ny(2025, 12, 23, 15, 59))
    assert not delayed_quotes_live(ny(2025, 12, 23, 16, 5))           # closed
    assert quotes_live_at(ny(2025, 12, 23, 16, 5)) is None and quotes_live_at(ny(2025, 12, 27, 9, 35)) is None
