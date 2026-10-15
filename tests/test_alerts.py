# tests/test_alerts.py — buy-back alerts to Discord (no real messages are sent)
from datetime import date, timedelta

import pytest

from core import alerts

HOOK = "https://discord.com/api/webhooks/123456789/abcDEF_ghi-jkl"


class _Resp:
    def __init__(self, status):
        self.status_code = status


@pytest.fixture
def discord(monkeypatch):
    """Capture what would be posted to Discord; set .status to make Discord refuse."""
    class Box:
        sent: list = []
        status = 204
    box = Box()
    box.sent = []

    def fake_post(url, json, timeout):
        box.sent.append((url, json))
        return _Resp(box.status)
    monkeypatch.setattr(alerts.requests, "post", fake_post)
    monkeypatch.setattr(alerts, "delayed_quotes_live", lambda: True)
    return box


def _call(client, entry_price, strike=125):
    expiry = (date.today() + timedelta(days=25)).isoformat()
    r = client.post("/positions", json=dict(ticker="NVDA", expiry=expiry, strike=strike, contracts=1,
                                            entry_price=entry_price, premium_total=entry_price * 100, allocation_type="Income"))
    assert r.status_code == 201, r.text


def _turn_on(client):
    assert client.put("/alerts", json={"discord_webhook": HOOK, "enabled": True}).status_code == 200


def test_settings_never_return_the_full_webhook(client):
    assert client.get("/alerts").json() == {"enabled": False, "webhook_set": False, "webhook_hint": None, "last_check_at": None,
                                            "check_overdue": False, "last_error": None, "notify_early": True, "notify_strike": True}
    body = client.put("/alerts", json={"discord_webhook": HOOK, "enabled": True}).json()
    assert body["enabled"] and body["webhook_set"]
    assert body["webhook_hint"] == "…" + HOOK[-6:]
    assert HOOK not in str(client.get("/alerts").json())


@pytest.mark.parametrize("bad", ["https://example.com/hook", "http://discord.com/api/webhooks/1/x", "discord.com/api/webhooks/1/x", "https://discord.com/api/webhooks/abc"])
def test_only_discord_webhooks_are_accepted(client, bad):
    r = client.put("/alerts", json={"discord_webhook": bad})
    assert r.status_code == 400
    assert "Discord webhook" in r.json()["detail"]


def test_cannot_turn_on_without_a_webhook(client):
    r = client.put("/alerts", json={"enabled": True})
    assert r.status_code == 400


def test_clearing_the_webhook_turns_alerts_off(client):
    _turn_on(client)
    body = client.put("/alerts", json={"clear_webhook": True}).json()
    assert (body["enabled"], body["webhook_set"], body["webhook_hint"], body["last_check_at"]) == (False, False, None, None)


def test_test_message_goes_to_the_saved_webhook(client, discord):
    assert client.post("/alerts/test").status_code == 400          # nothing saved yet
    _turn_on(client)
    assert client.post("/alerts/test").json() == {"sent": True}
    assert discord.sent[0][0] == HOOK and "connected" in discord.sent[0][1]["content"]


def test_discord_errors_are_explained(client, discord):
    _turn_on(client)
    discord.status = 404
    r = client.post("/alerts/test")
    assert r.status_code == 400 and "doesn't exist" in r.json()["detail"]


def test_alerts_once_for_calls_that_reach_the_target(client, nvda, discord):
    _turn_on(client)
    _call(client, entry_price=25.0)      # costs ~$3.15 now: 87% kept, past the 85% target
    _call(client, entry_price=4.0)       # 21% kept: keep holding
    first = client.post("/alerts/check").json()
    assert first == {"status": "ok", "checked": 2, "sent": 1}
    msg = discord.sent[0][1]
    assert "1 call ready to buy back" in msg["content"]
    assert msg["embeds"][0]["title"] == "Buy back now: NVDA $125.00 call"
    # Already alerted: the next check stays quiet
    assert client.post("/alerts/check").json()["sent"] == 0
    assert len(discord.sent) == 1
    assert client.get("/alerts").json()["last_check_at"]


def test_check_does_nothing_when_off_or_market_closed(client, nvda, discord, monkeypatch):
    _call(client, entry_price=25.0)
    assert client.post("/alerts/check").json() == {"status": "off", "sent": 0, "checked": None}
    _turn_on(client)
    monkeypatch.setattr(alerts, "delayed_quotes_live", lambda: False)
    assert client.post("/alerts/check").json()["status"] == "market_closed"
    assert client.post("/alerts/check", params={"force": True}).json()["sent"] == 1
    assert len(discord.sent) == 1


def test_failed_send_is_retried_next_time(client, nvda, discord):
    _turn_on(client)
    _call(client, entry_price=25.0)
    discord.status = 500
    assert client.post("/alerts/check").status_code == 502
    discord.status = 204
    assert client.post("/alerts/check").json()["sent"] == 1     # not marked as sent after the failure


def test_no_alert_for_a_call_that_should_just_expire(client, nvda, discord):
    _turn_on(client)
    expiry = (date.today() + timedelta(days=3)).isoformat()   # 3 days left, strike 25% above the stock
    r = client.post("/positions", json=dict(ticker="NVDA", expiry=expiry, strike=125, contracts=1, entry_price=25.0,
                                            premium_total=2500, allocation_type="Income"))
    assert r.status_code == 201, r.text
    assert client.post("/alerts/check").json()["sent"] == 0
    assert discord.sent == []


# --- An outside scheduler (cron-job.org) runs the check with its own key ---------------------

def test_scheduler_endpoint_is_off_without_a_key(client, monkeypatch):
    monkeypatch.delenv("ALERTS_KEY", raising=False)
    assert client.post("/alerts/cron", headers={"X-Alerts-Key": "anything"}).status_code == 404


def test_scheduler_endpoint_needs_the_right_key(client, monkeypatch):
    monkeypatch.setenv("ALERTS_KEY", "s3cret-key-for-tests")
    assert client.post("/alerts/cron").status_code == 401
    assert client.post("/alerts/cron", headers={"X-Alerts-Key": "wrong"}).status_code == 401


def test_scheduler_endpoint_runs_the_check_without_logging_in(client, nvda, discord, monkeypatch):
    _turn_on(client)
    _call(client, entry_price=25.0)                               # past the 85% target
    monkeypatch.setenv("ALERTS_KEY", "s3cret-key-for-tests")
    monkeypatch.setenv("APP_PASSWORD", "pw")                      # the rest of the API is locked
    assert client.post("/alerts/check").status_code == 401
    r = client.post("/alerts/cron", headers={"X-Alerts-Key": "s3cret-key-for-tests"})
    assert r.status_code == 202 and r.json() == {"status": "started"}
    assert len(discord.sent) == 1                                 # the check ran (in the background)
    assert discord.sent[0][1]["embeds"][0]["title"] == "Buy back now: NVDA $125.00 call"


# --- Early exercise and "above your strike" -----------------------------------------

def test_a_stock_above_the_strike_is_alerted_once(client, nvda, discord):
    _turn_on(client)
    _call(client, entry_price=3.0, strike=95)                  # NVDA is $100: above the strike, call costs more than sold
    assert client.post("/alerts/check").json()["sent"] == 1
    msg = discord.sent[-1][1]
    assert "stock above the strike" in msg["content"]
    assert msg["embeds"][0]["title"] == "NVDA is above your $95.00 strike"
    assert client.post("/alerts/check").json()["sent"] == 0    # once per call


def test_above_strike_alerts_can_be_turned_off(client, nvda, discord):
    _turn_on(client)
    assert client.put("/alerts", json={"notify_strike": False}).json()["notify_strike"] is False
    _call(client, entry_price=3.0, strike=95)
    assert client.post("/alerts/check").json()["sent"] == 0


def test_early_exercise_is_alerted_instead_of_above_strike(client, nvda, discord):
    from conftest import EVENTS, INFO
    EVENTS["NVDA"] = {"Earnings Date": [], "Ex-Dividend Date": date.today() + timedelta(days=5)}
    INFO["NVDA"] = {"lastDividendValue": 2.0}
    _turn_on(client)
    _call(client, entry_price=3.0, strike=90)                  # $10 in the money, little time value
    assert client.post("/alerts/check").json()["sent"] == 1
    embed = discord.sent[-1][1]["embeds"][0]
    assert embed["title"].startswith("May be exercised early: NVDA $90.00 call")
    assert "buy back or roll by" in embed["description"]
    assert client.post("/alerts/check").json()["sent"] == 0    # and not again as "above the strike"


def test_a_refused_message_is_remembered_until_one_goes_through(client, nvda, discord):
    _turn_on(client)
    _call(client, entry_price=3.0, strike=95)
    discord.status = 404
    assert client.post("/alerts/check").status_code == 502
    assert "doesn't exist" in client.get("/alerts").json()["last_error"]
    discord.status = 204
    assert client.post("/alerts/check").json()["sent"] == 1    # not marked sent before, so it's sent now
    assert client.get("/alerts").json()["last_error"] is None


# --- Has the scheduled check stopped? ---------------------------------------------------

def _ny(hour, minute, day=14):
    from datetime import datetime
    from core.market_hours import NEW_YORK
    return datetime(2026, 10, day, hour, minute, tzinfo=NEW_YORK)        # Oct 14, 2026 is a Wednesday


@pytest.mark.parametrize("now, last, overdue", [
    (_ny(11, 0), _ny(9, 45), True),            # 75 minutes without a check
    (_ny(11, 0), _ny(10, 30), False),
    (_ny(10, 0), _ny(15, 45, day=13), False),  # first check of the day was due at 9:45
    (_ny(10, 40), _ny(15, 45, day=13), True),  # ... and still hasn't run
    (_ny(11, 0, day=17), None, False),         # Saturday
    (_ny(17, 0), _ny(15, 45), False),          # after the close
])
def test_check_overdue(now, last, overdue):
    settings = {"enabled": True, "discord_webhook": HOOK, "last_check_at": last.isoformat() if last else None}
    assert alerts.check_overdue(settings, now=now) is overdue


def test_not_overdue_when_alerts_are_off():
    settings = {"enabled": False, "discord_webhook": HOOK, "last_check_at": None}
    assert alerts.check_overdue(settings, now=_ny(14, 0)) is False


def test_the_error_stays_until_a_message_goes_through(client, nvda, discord):
    _turn_on(client)
    _call(client, entry_price=3.0, strike=95)
    discord.status = 404
    client.post("/alerts/check")
    discord.status = 204
    client.post("/alerts/check")                               # sends the alert: works again
    assert client.get("/alerts").json()["last_error"] is None
    discord.status = 404
    _call(client, entry_price=3.0, strike=96)
    client.post("/alerts/check")
    assert client.post("/alerts/check").status_code == 502     # still failing
    assert client.get("/alerts").json()["last_error"]
    discord.status = 204
    assert client.post("/alerts/test").status_code == 200      # a test message clears it
    assert client.get("/alerts").json()["last_error"] is None
