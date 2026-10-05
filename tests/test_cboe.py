# tests/test_cboe.py — option chains from Cboe's delayed quotes, Yahoo as the fallback
from datetime import date, datetime, timedelta

import pytest
from conftest import CBOE, IMPLIED_VOL

from core import cache, cboe, market_data, scanner
from core.cboe import get_cboe_calls, get_cboe_price, parse_calls, parse_price
from core.market_hours import market_today


def _occ(root, expiry, strike, cp="C"):
    d = date.fromisoformat(expiry)
    return f"{root}{d:%y%m%d}{cp}{int(round(strike * 1000)):08d}"


def cboe_payload(root="NVDA", price=100.0, days=(25,), delta_for=lambda k: None, traded=None):
    """A Cboe-shaped payload: calls and puts for each expiry, plus another root (adjusted contracts)."""
    options = []
    today = date.fromisoformat(market_today())          # New York's date, like the app's
    for d in days:
        expiry = (today + timedelta(days=d)).isoformat()
        for k in range(90, 151):
            strike = float(k)
            mid = max(0.05, 6.0 - max(strike - price, 0) * 0.12)
            delta = delta_for(strike)
            options.append({
                "option": _occ(root, expiry, strike), "bid": round(mid * 0.95, 2), "ask": round(mid * 1.05, 2),
                "last_trade_price": round(mid, 2), "volume": 200, "open_interest": 900, "iv": 0.31,
                "delta": delta if delta is not None else 0.5, "last_trade_time": traded or datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
            })
            options.append({"option": _occ(root, expiry, strike, "P"), "bid": 1.0, "ask": 1.1, "delta": -0.3})
        options.append({"option": _occ(root + "1", expiry, 120.0), "bid": 9.0, "ask": 9.5, "delta": 0.4})
    return {"timestamp": "2026-10-02 16:15:00", "data": {"symbol": root, "current_price": price, "options": options}}


def test_parses_calls_only_for_the_stock_itself():
    df = parse_calls(cboe_payload(days=(25,)), "NVDA")
    expiry = (date.fromisoformat(market_today()) + timedelta(days=25)).isoformat()
    assert set(df["expiry"]) == {expiry} and len(df) == 61          # 61 strikes; puts and NVDA1 skipped
    row = df[df["strike"] == 110.0].iloc[0]
    assert row["source"] == "cboe" and row["impliedVolatility"] == 0.31 and row["openInterest"] == 900
    assert row["lastTradeDate"].tzinfo is not None                  # New York time
    assert parse_calls({"unexpected": True}, "NVDA") is None         # format changed: no Cboe data
    assert parse_calls(None, "NVDA") is None


def _delta(strike):            # a smooth fake: 0.5 at the money, falling 0.025 per dollar above it
    return round(max(0.01, 0.5 - (strike - 100) * 0.025), 3)


def test_scan_uses_cboe_prices_and_its_delta(client, nvda):
    CBOE["NVDA"] = cboe_payload(days=(18, 25), delta_for=_delta)
    scan = client.post("/scan", json={"ticker": "NVDA"}).json()
    assert scan["data_source"] == "cboe"
    assert scan["candidates"]
    for c in scan["candidates"]:
        assert c["delta"] == pytest.approx(_delta(c["strike"]), abs=0.001)    # the exchange's delta, not ours
        assert 0.20 <= c["delta"] <= 0.30


def test_falls_back_to_yahoo_when_cboe_has_nothing(client, nvda):
    scan = client.post("/scan", json={"ticker": "NVDA"}).json()
    assert scan["data_source"] == "yahoo" and scan["candidates"]


def test_after_hours_cboe_uses_the_closing_quote_not_an_old_trade(client, nvda, monkeypatch):
    monkeypatch.setattr(scanner, "delayed_quotes_live", lambda: False)
    IMPLIED_VOL["NVDA"] = 0.00001
    CBOE["NVDA"] = cboe_payload(days=(25,), delta_for=_delta, traded="2026-09-01T10:00:00")   # trades weeks old
    cache.clear()
    scan = client.post("/scan", json={"ticker": "NVDA"}).json()
    assert scan["candidates"]
    for c in scan["candidates"]:
        assert c["quote_quality"] == "STALE"                           # closing quote, not OLD
        mid = max(0.05, 6.0 - max(c["strike"] - 100, 0) * 0.12)
        assert c["premium_price"] == pytest.approx((round(mid * 0.95, 2) + round(mid * 1.05, 2)) / 2, abs=0.001)


def test_price_check_uses_cboe_and_says_so(client, nvda):
    from core.market_hours import market_today
    expiry = (date.fromisoformat(market_today()) + timedelta(days=25)).isoformat()
    CBOE["NVDA"] = cboe_payload(days=(25,), delta_for=_delta)
    client.post("/positions", json=dict(ticker="NVDA", expiry=expiry, strike=125, contracts=1, entry_price=25.0,
                                        premium_total=2500, allocation_type="Income"))
    r = client.get("/manage").json()
    assert r["data_source"] == "cboe" and r["positions"][0]["price_source"] == "cboe"


# --- The stock price comes from the same Cboe snapshot as the options -------------------------

def test_stock_price_is_read_from_the_cboe_payload():
    assert parse_price({"data": {"current_price": 31.2, "close": 30.0}}) == 31.2
    assert parse_price({"data": {"current_price": None, "close": 30.0}}) == 30.0     # e.g. before the open
    assert parse_price({"data": {"prev_day_close": 29.5}}) == 29.5
    assert parse_price({"data": {"options": []}}) is None
    assert parse_price(None) is None and parse_price({"data": "?"}) is None


def test_scan_uses_the_stock_price_from_the_same_snapshot(client, nvda):
    CBOE["NVDA"] = cboe_payload(price=104.0, days=(18, 25), delta_for=_delta)   # Yahoo says $100
    scan = client.post("/scan", json={"ticker": "NVDA"}).json()
    assert scan["current_price"] == 104.0
    assert scan["price_source"] == "cboe" and scan["data_source"] == "cboe"


def test_stock_price_falls_back_when_cboe_has_nothing(client, nvda):
    scan = client.post("/scan", json={"ticker": "NVDA"}).json()
    assert scan["current_price"] == 100.0 and scan["price_source"] == "yahoo"


def test_a_failed_cboe_download_is_not_retried_on_every_lookup(monkeypatch):
    calls = []
    monkeypatch.setattr(cboe, "_download", lambda symbol: calls.append(symbol))     # Cboe down: None
    assert market_data.get_price_quote("NVDA") == (100.0, "yahoo")
    assert get_cboe_calls("NVDA") is None and get_cboe_price("NVDA") is None
    assert calls == ["NVDA"]                                                        # one try, then a short wait


def test_first_15_minutes_after_the_open_use_the_closing_quote(client, nvda, monkeypatch):
    from datetime import timezone
    from api.routes import scan as scan_route
    CBOE["NVDA"] = cboe_payload(days=(18, 25), delta_for=_delta)
    monkeypatch.setattr(scanner, "delayed_quotes_live", lambda: False)          # 9:35: quotes still show yesterday
    at = datetime(2026, 10, 5, 13, 45, tzinfo=timezone.utc)
    monkeypatch.setattr(scan_route, "quotes_live_at", lambda: at)
    scan = client.post("/scan", json={"ticker": "NVDA"}).json()
    assert scan["quotes_live"] is False and scan["quotes_live_at"] == at.isoformat()
    assert all(c["quote_quality"] == "STALE" for c in scan["candidates"])


def test_closed_market_scan_works_when_no_option_has_a_last_trade_time(client, nvda, monkeypatch):
    payload = cboe_payload(days=(18, 25), delta_for=_delta)
    for o in payload["data"]["options"]:
        o["last_trade_time"] = None
    CBOE["NVDA"] = payload
    monkeypatch.setattr(scanner, "delayed_quotes_live", lambda: False)
    r = client.post("/scan", json={"ticker": "NVDA"})
    assert r.status_code == 200, r.text           # used to fail comparing an all-empty date column
    assert r.json()["candidates"]


def test_options_say_how_they_are_priced_when_not_live(client, nvda, monkeypatch):
    monkeypatch.setattr(scanner, "delayed_quotes_live", lambda: False)
    CBOE["NVDA"] = cboe_payload(days=(18, 25), delta_for=_delta)        # Cboe: closing bid/ask
    assert {c["price_basis"] for c in client.post("/scan", json={"ticker": "NVDA"}).json()["candidates"]} == {"closing"}
    CBOE.clear()
    cache.clear()                                                        # Yahoo: last trades
    bases = {c["price_basis"] for c in client.post("/scan", json={"ticker": "NVDA"}).json()["candidates"]}
    assert bases == {"last_trade"}
