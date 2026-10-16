# tests/test_accounts.py — accounts: sign-up, log-in, keeping each account's data apart,
# login limits, and taking over the data from before accounts existed
import sqlite3
from datetime import date, timedelta

import pytest

import api.auth as auth
from conftest import signed_up
from core import db


def _expiry(days=25):
    return (date.today() + timedelta(days=days)).isoformat()


def _call(c, **over):
    body = dict(ticker="NVDA", expiry=_expiry(), strike=125, contracts=1, entry_price=2.0, allocation_type="Income")
    return c.post("/positions", json={**body, **over})


# --- Logging in -----------------------------------------------------------------

DATA_ROUTES = [
    ("get", "/portfolio"), ("post", "/portfolio"), ("get", "/positions"), ("get", "/positions/all"),
    ("get", "/manage"), ("get", "/settings"), ("put", "/settings"), ("get", "/performance"),
    ("get", "/upcoming"), ("get", "/positions/assignment-review"), ("post", "/scan"), ("post", "/scan/all"),
    ("post", "/scan/save"), ("post", "/positions/1/roll"), ("get", "/positions/1/rolls"),
    ("post", "/positions/1/assign"), ("post", "/positions/1/undo"), ("patch", "/positions/1"),
    ("delete", "/positions/1"), ("delete", "/portfolio/AAPL"), ("get", "/alerts"), ("put", "/alerts"),
    ("post", "/alerts/test"), ("post", "/alerts/check"), ("get", "/auth/me"),
]


@pytest.mark.parametrize("method, url", DATA_ROUTES)
def test_every_data_route_needs_a_login(anonymous, method, url):
    assert getattr(anonymous, method)(url).status_code == 401


def test_public_routes_stay_open(anonymous):
    assert anonymous.get("/health").status_code == 200
    assert anonymous.get("/market").status_code == 200
    assert anonymous.get("/auth/status").json() == {"auth_required": True, "can_claim": False}


def test_sign_up_then_log_in(anonymous):
    r = anonymous.post("/auth/signup", json={"email": "  You@Example.com ", "password": "correct horse battery"})
    assert r.status_code == 201
    assert r.json()["email"] == "you@example.com"
    token = r.json()["token"]
    assert anonymous.get("/auth/me", headers={"Authorization": f"Bearer {token}"}).json() == {"email": "you@example.com"}
    again = anonymous.post("/auth/login", json={"email": "YOU@example.com", "password": "correct horse battery"})
    assert again.status_code == 200 and again.json()["email"] == "you@example.com"


@pytest.mark.parametrize("email, password, status", [
    ("not-an-email", "correct horse battery", 422),
    ("you@example.com", "short", 422),
])
def test_sign_up_checks_email_and_password(anonymous, email, password, status):
    r = anonymous.post("/auth/signup", json={"email": email, "password": password})
    assert r.status_code == status


def test_one_account_per_email(anonymous):
    signed_up("you@example.com")
    r = anonymous.post("/auth/signup", json={"email": "YOU@example.com", "password": "another password"})
    assert r.status_code == 409 and "Log in instead" in r.json()["detail"]


def test_wrong_password_or_unknown_email(anonymous, monkeypatch):
    signed_up("you@example.com")
    for body in ({"email": "you@example.com", "password": "nope nope nope"}, {"email": "who@example.com", "password": "x"}):
        r = anonymous.post("/auth/login", json=body)
        assert r.status_code == 401 and r.json()["detail"] == "Wrong email or password."


def test_tampered_and_expired_tokens_are_rejected(client):
    token = client.headers["Authorization"].split()[1]
    user_id = int(token.split(".")[0])
    tampered = token[:-1] + ("A" if token[-1] != "A" else "B")
    assert client.get("/portfolio", headers={"Authorization": f"Bearer {tampered}"}).status_code == 401
    someone_else = f"{user_id + 1}." + token.split(".", 1)[1]               # same signature, another account
    assert client.get("/portfolio", headers={"Authorization": f"Bearer {someone_else}"}).status_code == 401
    old, expires = auth.make_token(user_id, now=1_000_000)
    assert auth.token_user(old, now=expires + 1) is None


def test_tokens_survive_a_restart(client):
    db._engine.dispose()
    db._engine = None                                   # a redeploy: same database, new server
    assert client.get("/portfolio").status_code == 200


# --- Each account's data is its own -------------------------------------------------

@pytest.fixture
def two(client):
    """Account A with 500 NVDA and a call; account B with nothing."""
    assert client.post("/portfolio", json={"ticker": "NVDA", "shares": 500, "avg_cost": 130}).status_code == 201
    assert _call(client).status_code == 201
    return client, signed_up("b@example.com")


def test_accounts_dont_see_each_other(two):
    a, b = two
    assert b.get("/portfolio").json() == []
    assert b.get("/positions/all").json() == []
    assert b.get("/manage").json()["positions"] == []
    assert len(a.get("/positions").json()) == 1


def test_another_account_cant_touch_your_calls(two):
    a, b = two
    pid = a.get("/positions").json()[0]["id"]
    b.post("/portfolio", json={"ticker": "NVDA", "shares": 500, "avg_cost": 100})
    assert b.post("/positions/close", json={"position_id": pid, "close_cost": 1}).status_code == 404
    assert b.patch(f"/positions/{pid}", json={"entry_price": 9}).status_code == 404
    assert b.delete(f"/positions/{pid}").status_code == 404
    assert b.post(f"/positions/{pid}/assign", json={}).status_code == 404
    assert b.post(f"/positions/{pid}/undo").status_code == 404
    assert b.get(f"/positions/{pid}/rolls").status_code == 404
    roll = {"close_cost": 1, "expiry": _expiry(60), "strike": 130, "contracts": 1, "entry_price": 1}
    assert b.post(f"/positions/{pid}/roll", json=roll).status_code == 404
    assert a.get("/positions").json()[0]["entry_price"] == 2.0          # untouched


def test_two_accounts_can_hold_the_same_stock(two):
    a, b = two
    assert b.post("/portfolio", json={"ticker": "NVDA", "shares": 200, "avg_cost": 90}).status_code == 201
    assert [h["shares"] for h in a.get("/portfolio").json()] == [500]
    assert [h["shares"] for h in b.get("/portfolio").json()] == [200]
    assert b.delete("/portfolio/NVDA").status_code == 200
    assert [h["shares"] for h in a.get("/portfolio").json()] == [500]


def test_strategy_and_alerts_are_per_account(two):
    a, b = two
    a.put("/settings", json={**a.get("/settings").json(), "monthly_goal": 1500})
    assert b.get("/settings").json()["monthly_goal"] == 0
    a.put("/alerts", json={"discord_webhook": "https://discord.com/api/webhooks/1/abc", "enabled": True})
    assert b.get("/alerts").json()["webhook_set"] is False


# --- Limits -------------------------------------------------------------------------

def test_too_many_wrong_passwords_lock_that_email_for_a_while(anonymous, monkeypatch):
    signed_up("you@example.com")
    signed_up("other@example.com")
    clock = [1_000_000.0]
    monkeypatch.setattr(auth.time, "time", lambda: clock[0])
    for _ in range(auth.MAX_FAILURES):
        assert anonymous.post("/auth/login", json={"email": "you@example.com", "password": "nope"}).status_code == 401
    locked = anonymous.post("/auth/login", json={"email": "you@example.com", "password": "correct horse battery"})
    assert locked.status_code == 429
    assert locked.json()["detail"] == "Too many wrong passwords. Try again in 15 minutes."
    assert locked.headers["Retry-After"] == str(auth.LOCKOUT_SECONDS)
    other = anonymous.post("/auth/login", json={"email": "other@example.com", "password": "correct horse battery"})
    assert other.status_code == 200                                     # other accounts aren't locked
    clock[0] += auth.LOCKOUT_SECONDS
    assert anonymous.post("/auth/login", json={"email": "you@example.com", "password": "correct horse battery"}).status_code == 200


def test_a_right_password_clears_earlier_mistakes(anonymous, monkeypatch):
    signed_up("you@example.com")
    for _ in range(auth.MAX_FAILURES - 1):
        anonymous.post("/auth/login", json={"email": "you@example.com", "password": "nope"})
    assert anonymous.post("/auth/login", json={"email": "you@example.com", "password": "correct horse battery"}).status_code == 200
    assert anonymous.post("/auth/login", json={"email": "you@example.com", "password": "nope"}).status_code == 401


def test_new_accounts_are_capped_per_hour(anonymous):
    for i in range(auth.SIGNUPS_PER_HOUR):
        assert anonymous.post("/auth/signup", json={"email": f"u{i}@example.com", "password": "correct horse battery"}).status_code == 201
    r = anonymous.post("/auth/signup", json={"email": "late@example.com", "password": "correct horse battery"})
    assert r.status_code == 429


# --- Data from before accounts -----------------------------------------------------

@pytest.fixture
def old_database(tmp_path, monkeypatch):
    """A database from the single-password version: 500 NVDA, one call, a strategy and alerts."""
    path = tmp_path / "old.db"
    con = sqlite3.connect(path)
    con.executescript(f"""
        CREATE TABLE holdings (ticker VARCHAR(12) PRIMARY KEY, shares INTEGER NOT NULL, avg_cost FLOAT NOT NULL);
        INSERT INTO holdings VALUES ('NVDA', 500, 130);
        CREATE TABLE positions (id INTEGER PRIMARY KEY, ticker VARCHAR(12) NOT NULL, expiry VARCHAR(10) NOT NULL,
            strike FLOAT NOT NULL, contracts INTEGER NOT NULL, entry_price FLOAT NOT NULL, premium_total FLOAT NOT NULL,
            premium_source VARCHAR(16) NOT NULL, quote_quality VARCHAR(16) NOT NULL, allocation_type VARCHAR(16) NOT NULL,
            status VARCHAR(10) NOT NULL, opened_at VARCHAR(10) NOT NULL, closed_at VARCHAR(10));
        INSERT INTO positions VALUES (1, 'NVDA', '{_expiry()}', 125, 1, 2, 200, 'MID', 'LIVE', 'Income', 'OPEN', '2026-10-01', NULL);
        CREATE TABLE strategy (id INTEGER PRIMARY KEY, income_weight FLOAT NOT NULL, profit_capture_target_pct FLOAT NOT NULL,
            buyback_budget_pct FLOAT NOT NULL, monthly_goal FLOAT NOT NULL);
        INSERT INTO strategy VALUES (1, 0.7, 80, 0.15, 1500);
        CREATE TABLE alert_settings (id INTEGER PRIMARY KEY, discord_webhook VARCHAR(300), enabled INTEGER NOT NULL,
            last_check_at VARCHAR(25));
        INSERT INTO alert_settings VALUES (1, 'https://discord.com/api/webhooks/1/oldhook', 1, NULL);
    """)
    con.commit()
    con.close()
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{path}")
    monkeypatch.setattr(db, "_engine", None)


def _mine(c):
    return (c.get("/portfolio").json(), c.get("/positions").json(), c.get("/settings").json()["monthly_goal"],
            c.get("/alerts").json()["webhook_set"])


def test_old_data_waits_for_the_old_password(old_database, anonymous, monkeypatch):
    monkeypatch.setenv("APP_PASSWORD", "hunter2")
    assert anonymous.get("/auth/status").json()["can_claim"] is True

    stranger = signed_up("stranger@example.com")                       # signs up first: gets nothing
    holdings, calls, goal, alerts_set = _mine(stranger)
    assert (holdings, calls, goal, alerts_set) == ([], [], 0, False)

    wrong = anonymous.post("/auth/signup", json={"email": "owner@example.com", "password": "correct horse battery",
                                                 "claim_password": "guess"})
    assert wrong.status_code == 403

    r = anonymous.post("/auth/signup", json={"email": "owner@example.com", "password": "correct horse battery",
                                             "claim_password": "hunter2"})
    assert r.status_code == 201 and r.json()["claimed"] is True
    owner = anonymous
    owner.headers["Authorization"] = f"Bearer {r.json()['token']}"
    holdings, calls, goal, alerts_set = _mine(owner)
    assert [h["ticker"] for h in holdings] == ["NVDA"] and len(calls) == 1
    assert goal == 1500 and alerts_set is True
    assert owner.get("/auth/status").json()["can_claim"] is False       # nothing left to claim
    assert _mine(stranger) == ([], [], 0, False)


def test_without_an_old_password_the_first_account_takes_it(old_database):
    first = signed_up("first@example.com")
    assert [h["ticker"] for h in first.get("/portfolio").json()] == ["NVDA"]
    second = signed_up("second@example.com")
    assert second.get("/portfolio").json() == []


def test_old_alerts_arent_sent_until_claimed(old_database):
    from core import alerts
    assert alerts.accounts_with_alerts() == []
