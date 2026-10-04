# tests/test_cboe.py — option chains from Cboe's delayed quotes, Yahoo as the fallback
from datetime import date, datetime, timedelta

import pytest
from conftest import CBOE, IMPLIED_VOL

from core import cache, scanner
from core.cboe import parse_calls


def _occ(root, expiry, strike, cp="C"):
    d = date.fromisoformat(expiry)
    return f"{root}{d:%y%m%d}{cp}{int(round(strike * 1000)):08d}"


def cboe_payload(root="NVDA", price=100.0, days=(25,), delta_for=lambda k: None, traded=None):
    """A Cboe-shaped payload: calls and puts for each expiry, plus another root (adjusted contracts)."""
    options = []
    for d in days:
        expiry = (date.today() + timedelta(days=d)).isoformat()
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
    expiry = (date.today() + timedelta(days=25)).isoformat()
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
    monkeypatch.setattr(scanner, "is_market_open", lambda: False)
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
