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
    monkeypatch.setattr(alerts, "is_market_open", lambda: True)
    return box


def _call(client, entry_price, strike=125):
    expiry = (date.today() + timedelta(days=25)).isoformat()
    r = client.post("/positions", json=dict(ticker="NVDA", expiry=expiry, strike=strike, contracts=1,
                                            entry_price=entry_price, premium_total=entry_price * 100, allocation_type="Income"))
    assert r.status_code == 201, r.text


def _turn_on(client):
    assert client.put("/alerts", json={"discord_webhook": HOOK, "enabled": True}).status_code == 200


def test_settings_never_return_the_full_webhook(client):
    assert client.get("/alerts").json() == {"enabled": False, "webhook_set": False, "webhook_hint": None, "last_check_at": None}
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
    assert body == {"enabled": False, "webhook_set": False, "webhook_hint": None, "last_check_at": None}


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
    _call(client, entry_price=20.0)      # costs ~$3.15 now: 84% kept, past the 80% target
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
    _call(client, entry_price=20.0)
    assert client.post("/alerts/check").json() == {"status": "off", "sent": 0, "checked": None}
    _turn_on(client)
    monkeypatch.setattr(alerts, "is_market_open", lambda: False)
    assert client.post("/alerts/check").json()["status"] == "market_closed"
    assert client.post("/alerts/check", params={"force": True}).json()["sent"] == 1
    assert len(discord.sent) == 1


def test_failed_send_is_retried_next_time(client, nvda, discord):
    _turn_on(client)
    _call(client, entry_price=20.0)
    discord.status = 500
    assert client.post("/alerts/check").status_code == 502
    discord.status = 204
    assert client.post("/alerts/check").json()["sent"] == 1     # not marked as sent after the failure


def test_no_alert_for_a_call_that_should_just_expire(client, nvda, discord):
    _turn_on(client)
    expiry = (date.today() + timedelta(days=3)).isoformat()   # 3 days left, strike 25% above the stock
    r = client.post("/positions", json=dict(ticker="NVDA", expiry=expiry, strike=125, contracts=1, entry_price=20.0,
                                            premium_total=2000, allocation_type="Income"))
    assert r.status_code == 201, r.text
    assert client.post("/alerts/check").json()["sent"] == 0
    assert discord.sent == []
