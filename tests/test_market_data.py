# tests/test_market_data.py — price sources and calendar events
from datetime import date, timedelta

from core import cache, market_data
from conftest import EVENTS, INFO


class _Resp:
    def __init__(self, data):
        self._data = data

    def raise_for_status(self):
        pass

    def json(self):
        return self._data


def test_uses_alpha_vantage_when_it_answers(monkeypatch):
    monkeypatch.setattr(market_data, "ALPHA_VANTAGE_KEY", "k")
    monkeypatch.setattr(market_data.requests, "get", lambda *a, **k: _Resp({"Global Quote": {"05. price": "101.5"}}))
    assert market_data.get_current_price("NVDA") == 101.5


def test_falls_back_to_yahoo_when_rate_limited(monkeypatch):
    monkeypatch.setattr(market_data, "ALPHA_VANTAGE_KEY", "k")
    monkeypatch.setattr(market_data.requests, "get", lambda *a, **k: _Resp({"Note": "API call frequency exceeded"}))
    assert market_data.get_current_price("NVDA") == 100.0


def test_falls_back_to_yahoo_without_a_key(monkeypatch):
    monkeypatch.setattr(market_data, "ALPHA_VANTAGE_KEY", None)
    assert market_data.get_current_price("NVDA") == 100.0
    assert market_data.get_current_price("NOPE") is None


def test_price_is_cached(monkeypatch):
    calls = []
    monkeypatch.setattr(market_data, "ALPHA_VANTAGE_KEY", "k")
    monkeypatch.setattr(market_data.requests, "get",
                        lambda *a, **k: calls.append(1) or _Resp({"Global Quote": {"05. price": "50"}}))
    market_data.get_current_price("NVDA")
    market_data.get_current_price("NVDA")
    assert len(calls) == 1


def test_events_only_report_upcoming_dates():
    today = date.today()
    EVENTS["NVDA"] = {
        "Earnings Date": [today - timedelta(days=80), today + timedelta(days=10), today + timedelta(days=12)],
        "Ex-Dividend Date": today - timedelta(days=3),
    }
    assert market_data.get_events("NVDA") == {
        "earnings_date": (today + timedelta(days=10)).isoformat(),
        "ex_dividend_date": None,
        "earnings_unknown": False,
    }


def test_events_when_yahoo_has_none():
    assert market_data.get_events("AAPL") == {"earnings_date": None, "ex_dividend_date": None, "earnings_unknown": False}


def _yahoo_blocked(monkeypatch, blocked: list[bool]):
    """Yahoo's calendar comes back empty (what yfinance returns when it's rate limited) while blocked[0]."""
    real = type(market_data.yf.Ticker("NVDA")).calendar
    monkeypatch.setattr(type(market_data.yf.Ticker("NVDA")), "calendar",
                        property(lambda self: {} if blocked[0] else real.fget(self)))


def test_a_blocked_yahoo_answer_is_not_kept_as_no_earnings(monkeypatch):
    blocked = [True]
    _yahoo_blocked(monkeypatch, blocked)
    EVENTS["NVDA"] = {"Earnings Date": [date.today() + timedelta(days=10)]}
    first = market_data.get_events("NVDA")
    assert first["earnings_date"] is None and first["earnings_unknown"] is True

    # Yahoo answers again: it isn't asked until the short retry wait is over, then the date shows up
    blocked[0] = False
    assert market_data.get_events("NVDA")["earnings_unknown"] is True
    now = cache.time.monotonic()
    monkeypatch.setattr(cache.time, "monotonic", lambda: now + cache.RETRY_AFTER + 1)
    assert market_data.get_events("NVDA")["earnings_date"] == (date.today() + timedelta(days=10)).isoformat()


def test_saved_earnings_date_is_used_when_yahoo_is_blocked(monkeypatch):
    blocked = [False]
    _yahoo_blocked(monkeypatch, blocked)
    soon = (date.today() + timedelta(days=23)).isoformat()
    EVENTS["NVDA"] = {"Earnings Date": [date.fromisoformat(soon)]}
    assert market_data.get_events("NVDA")["earnings_date"] == soon     # Yahoo answers; saved

    # A restart (empty cache) while Yahoo is blocked still knows the date
    cache.clear()
    blocked[0] = True
    assert market_data.get_events("NVDA") == {"earnings_date": soon, "ex_dividend_date": None, "earnings_unknown": False}


def test_saved_date_that_has_passed_means_unknown(monkeypatch):
    from core import db
    with db.get_engine().begin() as c:
        c.execute(db.known_events.insert().values(
            ticker="NVDA", earnings_date=(date.today() - timedelta(days=2)).isoformat(),
            ex_dividend_date=None, checked_at="2026-01-01T00:00:00"))
    _yahoo_blocked(monkeypatch, [True])
    assert market_data.get_events("NVDA") == {"earnings_date": None, "ex_dividend_date": None, "earnings_unknown": True}


def test_funds_never_have_unknown_earnings(monkeypatch):
    _yahoo_blocked(monkeypatch, [True])
    INFO["NVDA"] = {"quoteType": "ETF"}
    assert market_data.get_events("NVDA")["earnings_unknown"] is False


def test_failed_company_info_is_not_kept_for_a_day():
    assert market_data.get_info("NVDA") == {}          # Yahoo had nothing
    cache.clear()                                       # the short retry wait passes
    INFO["NVDA"] = {"industry": "Semiconductors"}
    assert market_data.get_info("NVDA")["industry"] == "Semiconductors"
