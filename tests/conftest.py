# tests/conftest.py
"""
Shared fixtures: a fresh SQLite database per test and a fake market, so the
API can be tested end to end without network access.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pandas as pd
import pytest
import yfinance

from core import cache
from core import db
from core import scanner
from core import events

# Fake stock prices; any other ticker "doesn't exist"
PRICES = {"NVDA": 100.0, "AAPL": 200.0}

# Fake calendar events per ticker (Yahoo's Ticker.calendar shape); tests may change it
EVENTS: dict[str, dict] = {}

# Fake daily closes: (ticker, "YYYY-MM-DD") -> close
CLOSES: dict[tuple[str, str], float] = {}

# Fake recent price history (oldest first) per ticker, for realized volatility; tests may set it
HISTORY: dict[str, list[float]] = {}

# Fake Yahoo info (e.g. {"industry": "Semiconductors"}) per ticker; tests may set it
INFO: dict[str, dict] = {}

# Fake implied volatility per ticker (default 35%); ~0 mimics Yahoo outside market hours
IMPLIED_VOL: dict[str, float] = {}

# Strikes whose last trade was this many days ago (ticker -> {strike: days}); the rest traded just now
TRADED_DAYS_AGO: dict[str, dict[float, int]] = {}


def fake_expiries() -> tuple[str, ...]:
    today = date.today()
    return tuple((today + timedelta(days=d)).isoformat() for d in (7, 25, 32, 60))


class _Chain:
    def __init__(self, calls):
        self.calls = calls


class FakeTicker:
    """Stands in for yfinance.Ticker: strikes from 90% to 150% of the price."""

    def __init__(self, symbol: str):
        self.symbol = symbol

    @property
    def options(self):
        return fake_expiries() if self.symbol in PRICES else ()

    @property
    def fast_info(self):
        return {"last_price": PRICES.get(self.symbol)}

    @property
    def info(self):
        return INFO.get(self.symbol, {})

    @property
    def calendar(self):
        return EVENTS.get(self.symbol, {})

    def history(self, start=None, end=None, period=None):
        if start and (self.symbol, start) in CLOSES:
            return pd.DataFrame({"Close": [CLOSES[(self.symbol, start)]]})
        if period and self.symbol in HISTORY:
            return pd.DataFrame({"Close": HISTORY[self.symbol]})
        return pd.DataFrame({"Close": []})

    def option_chain(self, expiry: str):
        price = PRICES[self.symbol]
        rows = []
        for k in range(61):
            strike = round(price * (0.9 + k * 0.01), 0)
            mid = max(0.05, 6.0 - max(strike - price, 0) * 0.12)
            rows.append(dict(
                strike=strike, bid=round(mid * 0.95, 2), ask=round(mid * 1.05, 2), lastPrice=round(mid, 2),
                volume=100 + k, openInterest=500, impliedVolatility=IMPLIED_VOL.get(self.symbol, 0.35),
                lastTradeDate=pd.Timestamp(datetime.now(timezone.utc)
                                           - timedelta(days=TRADED_DAYS_AGO.get(self.symbol, {}).get(strike, 0))),
            ))
        return _Chain(pd.DataFrame(rows).drop_duplicates("strike").reset_index(drop=True))


@pytest.fixture(autouse=True)
def fake_market(monkeypatch):
    cache.clear()
    EVENTS.clear()
    CLOSES.clear()
    HISTORY.clear()
    INFO.clear()
    IMPLIED_VOL.clear()
    TRADED_DAYS_AGO.clear()
    # No real Fed calendar unless a test sets one, so results don't depend on today's date
    monkeypatch.setattr(events, "FED_MEETINGS", ())
    monkeypatch.setattr(yfinance, "Ticker", FakeTicker)
    monkeypatch.setattr(scanner, "get_current_price", lambda t: PRICES.get(t))
    monkeypatch.setattr(scanner, "is_market_open", lambda: True)


@pytest.fixture(autouse=True)
def fresh_db(tmp_path, monkeypatch):
    """Each test gets its own empty SQLite database."""
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'test.db'}")
    monkeypatch.setattr(db, "_engine", None)
    yield
    if db._engine is not None:
        db._engine.dispose()


@pytest.fixture(autouse=True)
def no_password(monkeypatch):
    monkeypatch.delenv("APP_PASSWORD", raising=False)
    monkeypatch.delenv("AUTH_SECRET", raising=False)


@pytest.fixture
def client():
    from fastapi.testclient import TestClient
    from api.main import app
    return TestClient(app)


@pytest.fixture
def nvda(client):
    """500 NVDA shares (5 contracts) bought at $130."""
    r = client.post("/portfolio", json={"ticker": "NVDA", "shares": 500, "avg_cost": 130})
    assert r.status_code == 201, r.text
    return r
