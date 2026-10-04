# tests/test_net_pricing.py — options ranked by what you'd actually keep, and the
# buy back / let it expire / keep holding rule
from datetime import date, timedelta

import pandas as pd
import pytest

from core.buyback import evaluate_position
from core.calculations import add_option_metrics
from core.config import DEFAULT_CONFIG
from core.filters import filter_covered_calls


def _fake_quote(strike, price=100.0):
    """The fake market's bid/ask for a strike (see conftest.FakeTicker)."""
    mid = max(0.05, 6.0 - max(strike - price, 0) * 0.12)
    return round(mid * 0.95, 2), round(mid * 1.05, 2)


# --- 1. Realistic fills and fees ---------------------------------------------------

def _set_commission(client, value):
    r = client.put("/settings", json=dict(income_weight=0.7, profit_capture_target_pct=85, buyback_budget_pct=0.15,
                                          monthly_goal=0, commission_per_contract=value))
    assert r.status_code == 200, r.text


def test_scan_prices_options_at_a_likely_fill_after_fees(client, nvda):
    _set_commission(client, 0.65)
    scan = client.post("/scan", json={"ticker": "NVDA"}).json()
    assert scan["fee_per_contract"] == 0.65
    c = scan["candidates"][0]
    bid, ask = _fake_quote(c["strike"])
    assert c["premium_price"] == pytest.approx((bid + ask) / 2, abs=0.001)   # sells usually fill at the midpoint
    assert c["net_per_contract"] == pytest.approx(c["premium_per_contract"] - 0.65, abs=0.01)
    yearly_on_net = c["net_per_contract"] / 100 / 100.0 / c["dte"] * 365 * 100
    assert c["annualized_yield_pct"] == pytest.approx(yearly_on_net, abs=0.02)
    contracts = sum(p["contracts"] for p in scan["planned_positions"])
    assert scan["estimated_fees"] == pytest.approx(0.65 * contracts)
    assert scan["net_premium"] == pytest.approx(scan["gross_premium"] - scan["buyback_budget"] - scan["estimated_fees"])


def test_no_commission_by_default_and_the_setting_is_used(client, nvda):
    assert DEFAULT_CONFIG.commission_per_contract == 0
    assert client.get("/settings").json()["commission_per_contract"] == 0
    c = client.post("/scan", json={"ticker": "NVDA"}).json()["candidates"][0]
    assert c["net_per_contract"] == c["premium_per_contract"]          # nothing taken off at $0
    # Recorded fees don't override the setting (a $0 broker records $0)
    expiry = (date.today() + timedelta(days=25)).isoformat()
    client.post("/positions", json=dict(ticker="NVDA", expiry=expiry, strike=125, contracts=2, entry_price=1.0,
                                        premium_total=200, allocation_type="Income", fees=2.10))
    assert client.post("/scan", json={"ticker": "NVDA"}).json()["fee_per_contract"] == 0
    _set_commission(client, 1.05)
    assert client.post("/scan", json={"ticker": "NVDA"}).json()["fee_per_contract"] == 1.05


def test_options_are_priced_at_the_midpoint_whatever_the_spread():
    expiry = (date.today() + timedelta(days=30)).isoformat()
    calls = pd.DataFrame([
        dict(strike=120.0, bid=0.95, ask=1.05, lastPrice=1.0, volume=100, openInterest=500, expiry=expiry, dte=30),
        dict(strike=121.0, bid=0.85, ask=1.15, lastPrice=1.0, volume=100, openInterest=500, expiry=expiry, dte=30),
    ])
    df = add_option_metrics(filter_covered_calls(calls, 115, 100.0), 100.0, fee_per_contract=0.65)
    assert df["premium_price"].tolist() == pytest.approx([1.00, 1.00])  # both $1.00 midpoints


def test_very_wide_spreads_are_skipped():
    expiry = (date.today() + timedelta(days=30)).isoformat()
    calls = pd.DataFrame([dict(strike=120.0, bid=0.80, ask=1.20, lastPrice=1.0, volume=100, openInterest=500,
                               expiry=expiry, dte=30)])                # 40% of the midpoint
    assert filter_covered_calls(calls, 115, 100.0).empty


def test_options_that_pay_less_than_the_commission_are_dropped(client, nvda):
    scan = client.post("/scan", json={"ticker": "NVDA", "min_premium": 0.01}).json()
    assert all(c["net_per_contract"] > 0 for c in scan["candidates"])


# --- 2. Buy back now / let it expire / keep holding ---------------------------------

TODAY = "2026-10-05"


def _pos(days, strike=110.0, entry=1.00, contracts=2):
    expiry = (date.fromisoformat(TODAY) + timedelta(days=days)).isoformat()
    return dict(ticker="NVDA", expiry=expiry, strike=strike, contracts=contracts, entry_price=entry)


def _eval(pos, price, stock=100.0):
    return evaluate_position(pos, price, stock_price=stock, fee_per_contract=0.65, today=TODAY)


def test_past_the_target_with_time_left_buy_back():
    r = _eval(_pos(days=20), price=0.15)                 # 85% kept, 20 days left
    assert (r.action, r.should_buy_back) == ("buy_back", True)
    assert r.cost_to_close == pytest.approx(0.15 * 200 + 0.65 * 2)   # includes the commission
    assert r.days_left == 20


def test_near_expiry_and_well_below_the_strike_let_it_expire():
    r = _eval(_pos(days=4, strike=110.0), price=0.05, stock=100.0)   # stock 10% below the strike
    assert (r.action, r.should_buy_back) == ("let_expire", False)


def test_near_expiry_but_close_to_the_strike_still_buy_back():
    r = _eval(_pos(days=4, strike=110.0), price=0.10, stock=107.0)   # only ~3% below the strike
    assert r.action == "buy_back"


def test_without_a_stock_price_err_on_buying_back():
    r = _eval(_pos(days=3), price=0.05, stock=None)
    assert r.action == "buy_back"


def test_below_the_target_keep_holding():
    r = _eval(_pos(days=4), price=0.40)                  # 60% kept
    assert (r.action, r.should_buy_back) == ("hold", False)
    assert _eval(_pos(days=4), price=0.0).action == "hold"   # no price: no recommendation


def test_manage_reports_the_action(client, nvda):
    from core.market_hours import market_today     # the app counts days in New York time
    _set_commission(client, 0.65)
    expiry = (date.fromisoformat(market_today()) + timedelta(days=25)).isoformat()
    client.post("/positions", json=dict(ticker="NVDA", expiry=expiry, strike=125, contracts=1, entry_price=25.0,
                                        premium_total=2500, allocation_type="Income"))
    e = client.get("/manage").json()["positions"][0]
    assert e["action"] == "buy_back" and e["should_buy_back"] is True
    assert e["stock_price"] == 100.0 and e["days_left"] == 25
    _, ask = _fake_quote(125)
    assert e["cost_to_close"] == pytest.approx(ask * 100 + 0.65)
