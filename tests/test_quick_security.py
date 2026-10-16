# tests/test_quick_security.py — the small protections: no sleeping on wrong passwords,
# limits on guessing the old password, scans and stocks, the alert scheduler's pace,
# logs by severity, and no public API docs on the live server
import logging

import pytest

from api import auth, limits
from api import main as api_main
from api.routes import portfolio as portfolio_routes
from conftest import signed_up


def test_wrong_passwords_answer_without_sleeping(anonymous, monkeypatch):
    # A sleep would hold one of the server's few worker threads, so a burst of wrong
    # passwords would stall every other request
    def no_sleep(_):
        raise AssertionError("login must not sleep")
    monkeypatch.setattr(auth.time, "sleep", no_sleep)
    signed_up("you@example.com")
    for _ in range(3):
        assert anonymous.post("/auth/login", json={"email": "you@example.com", "password": "nope"}).status_code == 401


def test_guesses_at_the_old_app_password_are_limited(anonymous, monkeypatch):
    monkeypatch.setenv("APP_PASSWORD", "hunter2")
    body = {"email": "x@example.com", "password": "correct horse battery", "claim_password": "guess"}
    for _ in range(auth.MAX_FAILURES):
        assert anonymous.post("/auth/signup", json=body).status_code == 403
    r = anonymous.post("/auth/signup", json={**body, "claim_password": "hunter2"})
    assert r.status_code == 429 and "Try again in 15 minutes" in r.json()["detail"]


def test_an_account_follows_at_most_25_stocks(client, monkeypatch):
    monkeypatch.setattr(portfolio_routes, "has_listed_options", lambda t: True)
    for i in range(portfolio_routes.MAX_HOLDINGS):
        assert client.post("/portfolio", json={"ticker": f"T{i:02d}", "shares": 100, "avg_cost": 10}).status_code == 201
    r = client.post("/portfolio", json={"ticker": "ONEMORE", "shares": 100, "avg_cost": 10})
    assert r.status_code == 422 and "up to 25 stocks" in r.json()["detail"]


def test_scans_are_limited_per_account(client, monkeypatch):
    monkeypatch.setattr(limits.SCANS, "count", 2)
    for _ in range(2):
        assert client.post("/scan", json={"ticker": "NVDA"}).status_code == 404     # not held, but it counts
    r = client.post("/scan", json={"ticker": "NVDA"})
    assert r.status_code == 429 and "Try again in 10 minutes" in r.json()["detail"]
    assert signed_up("other@example.com").post("/scan", json={"ticker": "NVDA"}).status_code == 404  # others aren't


def test_a_limit_frees_up_as_the_window_passes():
    limit = limits.Limit(1, 60, "Wait {minutes}.")
    limit.take("a", now=0)
    with pytest.raises(Exception) as e:
        limit.take("a", now=59)
    assert e.value.status_code == 429 and e.value.detail == "Wait 1 minute."
    limit.take("a", now=60)


def test_the_alert_scheduler_runs_at_most_every_20_minutes(anonymous, monkeypatch):
    monkeypatch.setenv("ALERTS_KEY", "k")
    ran = []
    monkeypatch.setattr("api.routes.alerts.check_all", lambda: ran.append(1) or {"status": "ok"})
    headers = {"X-Alerts-Key": "k"}
    assert anonymous.post("/alerts/cron", headers=headers).json() == {"status": "started"}
    second = anonymous.post("/alerts/cron", headers=headers).json()
    assert second["status"] == "skipped" and len(ran) == 1


def test_api_docs_are_hidden_on_railway():
    assert api_main._show_docs({}) is True                                   # your computer
    assert api_main._show_docs({"RAILWAY_ENVIRONMENT_NAME": "production"}) is False
    assert api_main._show_docs({"RAILWAY_ENVIRONMENT_NAME": "production", "API_DOCS": "1"}) is True


def test_routine_logs_go_to_stdout_and_problems_to_stderr(capsys):
    root = logging.getLogger()
    saved = root.handlers[:], root.level
    try:
        api_main._logs_by_severity()
        logging.getLogger("api.test").info("checked 2 calls")
        logging.getLogger("api.test").warning("Discord said no")
        out, err = capsys.readouterr()
        assert "checked 2 calls" in out and "checked 2 calls" not in err
        assert "Discord said no" in err and "Discord said no" not in out
    finally:
        root.handlers, root.level = saved
