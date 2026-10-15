# tests/test_rolls.py — finding a roll, and calls likely to be exercised early for the dividend
from datetime import date, timedelta

import pytest

from conftest import EVENTS, INFO, fake_expiries
from core import rolls
from core.buyback import early_exercise_risk
from core.market_hours import market_today, previous_trading_day


def _day(n: int) -> str:
    return (date.fromisoformat(market_today()) + timedelta(days=n)).isoformat()


@pytest.fixture
def call(client, nvda, monkeypatch):
    """
    2 NVDA $110 calls on the fake market's nearest expiry, about a week out (it lists
    7, 25, 32 and 60 days from the machine's date). Its own dates, not ones worked out
    here: between 8 pm and midnight in New York, a runner's UTC date is a day ahead.
    """
    monkeypatch.setattr(rolls, "delayed_quotes_live", lambda: True)
    r = client.post("/positions", json=dict(ticker="NVDA", expiry=fake_expiries()[0], strike=110, contracts=2,
                                            entry_price=0.50, allocation_type="Income"))
    assert r.status_code == 201, r.text
    return client.get("/positions").json()[0]["id"]


def _buyback_at(monkeypatch, price):
    monkeypatch.setattr(rolls, "get_current_option_quote",
                        lambda *a, **k: {"price": price, "old_trade_date": None, "source": "yahoo"})


def test_rolls_go_up_and_out_for_a_credit(client, call, monkeypatch):
    _buyback_at(monkeypatch, 1.00)
    body = client.get(f"/positions/{call}/rolls").json()
    assert body["buyback_price"] == 1.00 and body["note"] is None
    found = body["rolls"]
    assert 0 < len(found) <= rolls.MAX_ROLLS
    strikes = [r["strike"] for r in found]
    assert strikes == sorted(strikes, reverse=True) and min(strikes) >= 110
    for r in found:
        assert r["net_total"] > 0
        assert r["net_total"] == pytest.approx((r["price"] - 1.00) * 200, abs=0.02)
        assert r["strike_gain"] == pytest.approx((r["strike"] - 110) * 200)
        assert r["expiry"] == fake_expiries()[1]       # the soonest later expiry that pays
        assert r["delta"] is not None


def test_rolls_count_both_commissions(client, call, monkeypatch):
    _buyback_at(monkeypatch, 1.00)
    free = {r["strike"]: r for r in client.get(f"/positions/{call}/rolls").json()["rolls"]}
    client.put("/settings", json={**client.get("/settings").json(), "commission_per_contract": 0.65})
    paid = {r["strike"]: r for r in client.get(f"/positions/{call}/rolls").json()["rolls"]}
    for strike in set(free) & set(paid):
        assert paid[strike]["net_total"] == pytest.approx(free[strike]["net_total"] - 2 * 0.65 * 2, abs=0.01)


def test_no_roll_when_every_one_is_a_debit(client, call, monkeypatch):
    _buyback_at(monkeypatch, 50.0)
    body = client.get(f"/positions/{call}/rolls").json()
    assert body["rolls"] == [] and "debit" in body["note"]


def test_no_roll_without_a_price_to_buy_back(client, call, monkeypatch):
    _buyback_at(monkeypatch, 0.0)
    body = client.get(f"/positions/{call}/rolls").json()
    assert body["rolls"] == [] and body["buyback_price"] is None and "no current price" in body["note"]


def test_rolls_above_your_range_are_marked(client, call, monkeypatch):
    _buyback_at(monkeypatch, 4.00)                      # only strikes near the price pay a credit
    client.put("/settings", json={**client.get("/settings").json(), "delta_min": 0.05, "delta_max": 0.06})
    found = client.get(f"/positions/{call}/rolls").json()["rolls"]
    assert all(r["above_range"] == (r["delta"] > 0.06) for r in found)
    assert any(r["above_range"] for r in found)


def test_rolls_for_a_missing_call_is_404(client, nvda):
    assert client.get("/positions/999/rolls").status_code == 404


# --- Early exercise before the ex-dividend date ------------------------------------

def test_early_exercise_when_time_value_is_below_the_dividend():
    risk = early_exercise_risk(440, 448.90, 9.28, "2026-11-20", "2026-11-19", 0.91, "2026-10-14")
    assert risk == {"ex_dividend_date": "2026-11-19", "dividend": 0.91, "time_value": 0.38, "exercise_by": "2026-11-18"}


@pytest.mark.parametrize("args", [
    (440, 448.90, 10.00, "2026-11-20", "2026-11-19", 0.91, "2026-10-14"),   # more time value than the dividend
    (440, 430.00, 1.00, "2026-11-20", "2026-11-19", 0.91, "2026-10-14"),    # out of the money
    (440, 448.90, 9.28, "2026-11-13", "2026-11-19", 0.91, "2026-10-14"),    # expires before the ex-dividend date
    (440, 448.90, 9.28, "2026-11-20", "2026-11-19", 0.91, "2026-11-19"),    # it's already ex-dividend
    (440, 448.90, 9.28, "2026-11-20", "2026-11-19", None, "2026-10-14"),    # dividend unknown
])
def test_no_early_exercise_warning(args):
    assert early_exercise_risk(*args) is None


def test_the_day_before_skips_weekends_and_holidays():
    assert previous_trading_day("2026-11-16") == "2026-11-13"      # Monday -> Friday
    assert previous_trading_day("2026-11-27") == "2026-11-25"      # after Thanksgiving


def test_price_check_flags_an_early_exercise(client, nvda):
    EVENTS["NVDA"] = {"Earnings Date": [], "Ex-Dividend Date": date.fromisoformat(_day(5))}
    INFO["NVDA"] = {"lastDividendValue": 2.0}
    client.post("/positions", json=dict(ticker="NVDA", expiry=_day(25), strike=90, contracts=1,
                                        entry_price=3.0, allocation_type="Income"))   # $10 in the money
    got = client.get("/manage").json()["positions"][0]
    risk = got["early_exercise"]
    assert risk["ex_dividend_date"] == _day(5) and risk["dividend"] == 2.0
    assert risk["exercise_by"] == previous_trading_day(_day(5))


def test_no_early_exercise_flag_out_of_the_money(client, nvda):
    EVENTS["NVDA"] = {"Earnings Date": [], "Ex-Dividend Date": date.fromisoformat(_day(5))}
    INFO["NVDA"] = {"lastDividendValue": 2.0}
    client.post("/positions", json=dict(ticker="NVDA", expiry=_day(25), strike=120, contracts=1,
                                        entry_price=3.0, allocation_type="Income"))
    assert client.get("/manage").json()["positions"][0]["early_exercise"] is None
