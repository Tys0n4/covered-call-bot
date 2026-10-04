# tests/test_algo_accuracy.py — delta outside market hours, dividends, the goal
# pace on premium you expect to keep, New York dates, Fed calendar coverage
from datetime import date, timedelta

import pandas as pd
import pytest
from conftest import EVENTS, IMPLIED_VOL, INFO

from core import cache, events, market_data, scanner
from core.greeks import add_estimated_delta, call_price, estimate_call_delta, implied_vol_from_price


def _scan(client, **kw):
    r = client.post("/scan", json={"ticker": "NVDA", **kw})
    assert r.status_code == 200, r.text
    return r.json()


# --- 1. Delta when Yahoo's implied volatility is junk ----------------------------------

def test_volatility_is_recovered_from_the_option_price():
    price = call_price(100, 110, 25, 0.35)
    assert implied_vol_from_price(price, 100, 110, 25) == pytest.approx(0.35, abs=1e-4)
    assert implied_vol_from_price(0.50, 100, 80, 25) is None          # below what it's worth exercised now


def test_delta_falls_back_to_price_then_recent_moves():
    df = pd.DataFrame([
        dict(strike=110.0, dte=25, impliedVolatility=0.00001, mid=0.0, lastPrice=round(call_price(100, 110, 25, 0.35), 2)),
        dict(strike=110.0, dte=25, impliedVolatility=0.00001, mid=0.0, lastPrice=0.0),
    ])
    out = add_estimated_delta(df, 100.0, fallback_vol=0.35)
    assert list(out["delta_source"]) == ["price", "history"]
    expected = estimate_call_delta(100, 110, 25, 0.35)
    assert out["delta"].tolist() == pytest.approx([expected, expected], abs=0.005)
    assert add_estimated_delta(df.iloc[[1]], 100.0)["delta"].isna().all()   # nothing to go on


def test_scan_after_hours_still_finds_options_in_your_range(client, nvda, monkeypatch):
    IMPLIED_VOL["NVDA"] = 0.00001                      # what Yahoo reports outside market hours
    monkeypatch.setattr(scanner, "is_market_open", lambda: False)
    scan = _scan(client)
    assert scan["candidates"] and scan["income_pick"] and scan["balanced_pick"]
    assert all(0.20 <= c["delta"] <= 0.30 for c in scan["candidates"])
    assert any("estimated from last trade prices" in w for w in scan["warnings"])


def test_live_volatility_needs_no_warning(client, nvda):
    assert not any("estimated from" in w for w in _scan(client)["warnings"])


# --- 5. Dividends -------------------------------------------------------------------------

def test_dividends_lower_the_chance_of_being_called(client, nvda):
    assert estimate_call_delta(100, 110, 25, 0.35, dividend_yield=0.04) < estimate_call_delta(100, 110, 25, 0.35)
    plain = {c["strike"]: c["delta"] for c in _scan(client)["candidates"]}
    INFO["NVDA"] = {"dividendRate": 4.0}               # $4 a year on a $100 stock
    cache.clear()
    payer = {c["strike"]: c["delta"] for c in _scan(client)["candidates"]}
    both = plain.keys() & payer.keys()
    assert both and all(payer[k] < plain[k] for k in both)


# --- 2. Goal pace on what you expect to keep -----------------------------------------------

def test_monthly_income_is_what_you_keep_after_buying_back(client, nvda):
    scan = _scan(client)
    fee = scan["fee_per_contract"]
    for c in scan["candidates"]:
        kept = c["premium_per_contract"] * 0.85 - 2 * fee
        assert c["monthly_per_contract"] == pytest.approx(kept / c["dte"] * 30.4, abs=0.02)


def test_before_earnings_the_earlier_buy_back_counts(client, nvda):
    EVENTS["NVDA"] = {"Earnings Date": [date.today() + timedelta(days=20)]}
    scan = _scan(client)
    spanning = [c for c in scan["candidates"] if c["spans_earnings"]]
    assert spanning
    for c in spanning:
        kept = c["premium_per_contract"] * 0.65 - 2 * scan["fee_per_contract"]
        assert c["monthly_per_contract"] == pytest.approx(kept / c["dte"] * 30.4, abs=0.02)


# --- 3. Fed calendar coverage, and New York dates -----------------------------------------

def test_scan_says_when_the_fed_calendar_runs_out(client, nvda, monkeypatch):
    monkeypatch.setattr(events, "FED_MEETINGS", ((date.today() + timedelta(days=3)).isoformat(),))
    assert any("Fed calendar ends" in w for w in _scan(client)["warnings"])
    monkeypatch.setattr(events, "FED_MEETINGS", ((date.today() + timedelta(days=90)).isoformat(),))
    assert not any("Fed calendar ends" in w for w in _scan(client)["warnings"])


def test_earnings_dates_are_judged_in_new_york_time(monkeypatch):
    EVENTS["NVDA"] = {"Earnings Date": [date(2026, 10, 20)]}
    monkeypatch.setattr(market_data, "market_today", lambda: "2026-10-21")    # already past in New York
    assert market_data.get_events("NVDA")["earnings_date"] is None
