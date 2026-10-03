# tests/test_market_data.py — price sources and calendar events
from datetime import date, timedelta

from core import market_data
from conftest import EVENTS


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
    }


def test_events_when_yahoo_has_none():
    assert market_data.get_events("AAPL") == {"earnings_date": None, "ex_dividend_date": None}
