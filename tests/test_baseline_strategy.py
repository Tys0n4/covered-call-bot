# tests/test_baseline_strategy.py — the baseline strategy: 0.20–0.30 delta, 14–30 days,
# picks paced to the monthly goal, safer around events, 85% / 65% buy-backs
from datetime import date, timedelta

import pytest
from conftest import EVENTS, INFO

from core import cache, events
from core.buyback import evaluate_position, next_event
from core.config import DEFAULT_CONFIG


def _days(n):
    return (date.today() + timedelta(days=n)).isoformat()


def _scan(client, **kw):
    r = client.post("/scan", json={"ticker": "NVDA", **kw})
    assert r.status_code == 200, r.text
    return r.json()


# --- Strategy settings ---------------------------------------------------------------

def test_baseline_defaults(client):
    s = client.get("/settings").json()
    assert (s["delta_min"], s["delta_max"]) == (0.20, 0.30)
    assert (s["min_dte"], s["max_dte"]) == (14, 30)
    assert (s["profit_capture_target_pct"], s["event_buyback_pct"]) == (85, 65)
    assert s["income_weight"] == 0.70


def test_settings_are_editable_and_partial_saves_keep_the_rest(client):
    body = dict(income_weight=0.6, profit_capture_target_pct=80, buyback_budget_pct=0.1, monthly_goal=500,
                delta_min=0.15, delta_max=0.25, min_dte=10, max_dte=21, event_buyback_pct=60)
    assert client.put("/settings", json=body).status_code == 200
    # An older page that only knows the first four fields doesn't reset the new ones
    client.put("/settings", json=dict(income_weight=0.7, profit_capture_target_pct=80, buyback_budget_pct=0.1, monthly_goal=500))
    s = client.get("/settings").json()
    assert (s["delta_min"], s["delta_max"], s["min_dte"], s["max_dte"], s["event_buyback_pct"]) == (0.15, 0.25, 10, 21, 60)


@pytest.mark.parametrize("bad", [
    dict(delta_min=0.3, delta_max=0.2),
    dict(min_dte=30, max_dte=14),
    dict(event_buyback_pct=90),                 # above the usual 85% target
])
def test_settings_reject_inconsistent_ranges(client, bad):
    body = dict(income_weight=0.7, profit_capture_target_pct=85, buyback_budget_pct=0.15, monthly_goal=0, **bad)
    assert client.put("/settings", json=body).status_code == 422


# --- Delta range and expiry window ----------------------------------------------------------

def test_scan_uses_the_strategy_window_and_delta_range(client, nvda):
    scan = _scan(client)
    assert (scan["delta_min"], scan["delta_max"], scan["min_dte"], scan["max_dte"]) == (0.2, 0.3, 14, 30)
    assert scan["candidates"]
    assert all(0.20 <= c["delta"] <= 0.30 for c in scan["candidates"])
    assert all(14 <= c["dte"] <= 30 for c in scan["candidates"])
    # No goal: balanced sits at the safe end, income takes the best payer in range
    assert scan["balanced_pick"]["delta"] <= 0.23
    assert scan["income_pick"]["delta"] > scan["balanced_pick"]["delta"]
    assert scan["goal_check"] is None


def test_no_options_in_the_delta_range_is_explained(client, nvda):
    client.put("/settings", json=dict(income_weight=0.7, profit_capture_target_pct=85, buyback_budget_pct=0.15,
                                      monthly_goal=0, delta_min=0.55, delta_max=0.6))
    scan = _scan(client)
    assert scan["candidates"] == [] and scan["income_pick"] is None
    assert any("55%–60% chance of being called" in w for w in scan["warnings"])


# --- Goal-aware picks -------------------------------------------------------------------------

def _set_goal(client, goal):
    client.put("/settings", json=dict(income_weight=0.7, profit_capture_target_pct=85, buyback_budget_pct=0.15, monthly_goal=goal))


def test_income_pick_takes_the_lowest_delta_that_meets_the_goal(client, nvda):
    base = _scan(client)
    bal = base["balanced_pick"]
    others = sorted((c for c in base["candidates"] if c["strike"] != bal["strike"]), key=lambda c: c["delta"])
    blend = {c["strike"]: 0.7 * c["monthly_per_contract"] + 0.3 * bal["monthly_per_contract"] for c in others}
    safest, riskiest = others[0], others[-1]
    assert blend[safest["strike"]] < blend[riskiest["strike"]]

    # A goal the safest option already meets: no extra risk taken
    _set_goal(client, blend[safest["strike"]] * 5 * 0.99)           # NVDA: 5 contracts
    scan = _scan(client)
    assert scan["income_pick"]["strike"] == safest["strike"]
    g = scan["goal_check"]
    assert g["met"] and g["contracts"] == 5 and g["plan_per_contract"] >= g["pace_per_contract"]

    # A goal only the riskier option meets
    _set_goal(client, (blend[safest["strike"]] + blend[riskiest["strike"]]) / 2 * 5)
    assert _scan(client)["income_pick"]["strike"] == riskiest["strike"]

    # Out of reach: best payer in range, and it says so
    _set_goal(client, blend[riskiest["strike"]] * 5 * 2)
    scan = _scan(client)
    assert scan["income_pick"]["delta"] <= 0.30
    assert scan["goal_check"]["met"] is False


# --- Events --------------------------------------------------------------------------------------

def test_fed_meeting_in_the_window_keeps_picks_at_the_safe_end(client, nvda, monkeypatch):
    monkeypatch.setattr(events, "FED_MEETINGS", (_days(10),))
    scan = _scan(client)
    assert scan["fed_dates"] == [_days(10)]
    assert all(c["spans_fed"] for c in scan["candidates"])
    assert scan["income_pick"]["delta"] <= 0.23 and scan["balanced_pick"]["delta"] <= 0.23
    # The first sentence (all the app shows until you tap More) says why the picks still cross it
    fed = next(w for w in scan["warnings"] if "rate decision" in w)
    assert "before both picks expire, so they're kept near the safe end of your range." in fed.split(". ")[0] + "."


def test_industry_leaders_and_your_stocks_earnings_are_flagged(client, nvda):
    INFO["NVDA"] = {"industry": "Semiconductors"}
    INFO["AAPL"] = {"industry": "Semiconductors"}        # pretend, so AAPL counts as "yours"
    client.post("/portfolio", json={"ticker": "AAPL", "shares": 100, "avg_cost": 150})
    EVENTS["AMD"] = {"Earnings Date": [date.today() + timedelta(days=12)]}
    EVENTS["AAPL"] = {"Earnings Date": [date.today() + timedelta(days=8)]}
    scan = _scan(client)
    assert [(e["ticker"], e["why"]) for e in scan["industry_earnings"]] == [("AAPL", "yours"), ("AMD", "leader")]
    assert all(c["spans_industry"] for c in scan["candidates"])
    assert any("Others in NVDA's industry report earnings" in w and "AAPL, AMD" in w for w in scan["warnings"])
    assert scan["income_pick"]["delta"] <= 0.23


def test_unknown_industry_adds_nothing(client, nvda):
    assert _scan(client)["industry_earnings"] == []


# --- Buy-backs ---------------------------------------------------------------------------------

TODAY = "2026-10-05"


def _pos(days, strike=110.0, entry=1.00):
    return dict(ticker="NVDA", expiry=(date.fromisoformat(TODAY) + timedelta(days=days)).isoformat(),
                strike=strike, contracts=1, entry_price=entry)


def test_earlier_target_before_an_event():
    fed = {"kind": "fed", "date": "2026-10-28"}
    calm = evaluate_position(_pos(25), 0.30, today=TODAY, stock_price=100.0)              # 70% kept
    assert (calm.action, calm.target_pct) == ("hold", 85.0)
    before = evaluate_position(_pos(25), 0.30, today=TODAY, stock_price=100.0, event=fed)
    assert (before.action, before.target_pct, before.event) == ("buy_back", 65.0, fed)


def test_never_let_expire_through_an_event():
    earnings = {"kind": "earnings", "date": "2026-10-08"}
    r = evaluate_position(_pos(4, strike=110.0), 0.05, today=TODAY, stock_price=100.0, event=earnings)
    assert r.action == "buy_back"


def test_next_event_finds_earnings_or_the_fed_before_expiry(monkeypatch):
    monkeypatch.setattr(events, "FED_MEETINGS", ("2026-10-28",))
    EVENTS["NVDA"] = {"Earnings Date": [date(2026, 10, 20)]}
    assert next_event("NVDA", "2026-10-30", today="2026-10-05") == {"kind": "earnings", "date": "2026-10-20"}
    assert next_event("NVDA", "2026-10-15", today="2026-10-05") is None
    EVENTS.clear()
    cache.clear()                                    # earnings dates are cached for hours
    assert next_event("NVDA", "2026-10-30", today="2026-10-05") == {"kind": "fed", "date": "2026-10-28"}


def test_event_target_drives_alerts(client, nvda, monkeypatch):
    from core import alerts
    sent = []
    monkeypatch.setattr(alerts.requests, "post", lambda url, json, timeout: sent.append(json) or type("R", (), {"status_code": 204})())
    monkeypatch.setattr(alerts, "delayed_quotes_live", lambda: True)
    from core.market_hours import market_today
    monkeypatch.setattr(events, "FED_MEETINGS", ((date.fromisoformat(market_today()) + timedelta(days=10)).isoformat(),))
    client.put("/alerts", json={"discord_webhook": "https://discord.com/api/webhooks/1/abc", "enabled": True})
    expiry = (date.fromisoformat(market_today()) + timedelta(days=25)).isoformat()
    client.post("/positions", json=dict(ticker="NVDA", expiry=expiry, strike=125, contracts=1, entry_price=10.0,
                                        premium_total=1000, allocation_type="Income"))   # ~68% kept
    assert client.post("/alerts/check").json()["sent"] == 1
    desc = sent[0]["embeds"][0]["description"]
    assert "your target is 65%" in desc and "rate decision" in desc
    assert DEFAULT_CONFIG.event_buyback_pct == 65
