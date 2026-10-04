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


# --- Old last trades outside market hours -------------------------------------------------

def test_last_session_is_the_latest_trading_day_that_opened():
    from datetime import datetime

    from core.market_hours import NEW_YORK, last_session
    assert last_session(datetime(2026, 10, 4, 12, tzinfo=NEW_YORK)) == date(2026, 10, 2)    # Sunday → Friday
    assert last_session(datetime(2026, 10, 5, 8, tzinfo=NEW_YORK)) == date(2026, 10, 2)     # Monday before the open
    assert last_session(datetime(2026, 10, 5, 10, tzinfo=NEW_YORK)) == date(2026, 10, 5)


def _after_hours(monkeypatch):
    IMPLIED_VOL["NVDA"] = 0.00001
    monkeypatch.setattr(scanner, "is_market_open", lambda: False)


def test_old_trades_are_marked_and_skipped_by_the_picks(client, nvda, monkeypatch):
    from conftest import TRADED_DAYS_AGO
    _after_hours(monkeypatch)
    fresh = _scan(client)
    bal = fresh["balanced_pick"]["strike"]
    TRADED_DAYS_AGO["NVDA"] = {bal: 10}                # the balanced pick's strike last traded 10 days ago
    cache.clear()
    scan = _scan(client)
    old = [c for c in scan["candidates"] if c["quote_quality"] == "OLD"]
    assert old and all(c["strike"] == bal for c in old)
    assert all(c["last_trade_date"] for c in scan["candidates"])
    assert scan["balanced_pick"]["strike"] != bal and scan["income_pick"]["strike"] != bal
    assert any("haven't traded since before" in w and "picks skip them" in w for w in scan["warnings"])


def test_old_trades_dont_set_the_volatility():
    df = pd.DataFrame([dict(strike=110.0, dte=25, impliedVolatility=0.00001, mid=0.0, lastPrice=9.99, quote_quality="OLD")])
    out = add_estimated_delta(df, 100.0, fallback_vol=0.35)
    assert out["delta_source"].iloc[0] == "history"
    assert out["delta"].iloc[0] == pytest.approx(estimate_call_delta(100, 110, 25, 0.35), abs=0.001)


def test_when_every_price_is_old_it_says_so(client, nvda, monkeypatch):
    from conftest import TRADED_DAYS_AGO
    _after_hours(monkeypatch)
    TRADED_DAYS_AGO["NVDA"] = {float(k): 10 for k in range(80, 200)}
    scan = _scan(client)
    assert scan["candidates"] and all(c["quote_quality"] == "OLD" for c in scan["candidates"])
    assert any("None of the options in your range has traded since before" in w for w in scan["warnings"])


# --- Dashboard: coming up --------------------------------------------------------------------

def test_upcoming_lists_fed_and_your_holdings_earnings(client, nvda, monkeypatch):
    from core.market_hours import market_today
    today = date.fromisoformat(market_today())
    monkeypatch.setattr(events, "FED_MEETINGS", ((today + timedelta(days=10)).isoformat(), (today + timedelta(days=60)).isoformat()))
    EVENTS["NVDA"] = {"Earnings Date": [today + timedelta(days=20)]}
    r = client.get("/upcoming").json()
    assert r["fed"] == [(today + timedelta(days=10)).isoformat()]
    assert r["earnings"] == [{"ticker": "NVDA", "date": (today + timedelta(days=20)).isoformat()}]
    assert r["fed_known_until"] == (today + timedelta(days=60)).isoformat()
