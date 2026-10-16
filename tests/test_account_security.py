# tests/test_account_security.py — change password, log out other devices, recovery codes
# instead of email, deleting an account, and login limits that survive a restart
import re

from api import auth
from core import db
from conftest import signed_up

PASSWORD = "correct horse battery"


def _login(c, email="you@example.com", password=PASSWORD):
    return c.post("/auth/login", json={"email": email, "password": password})


def _bearer(token):
    return {"Authorization": f"Bearer {token}"}


# --- Recovery codes ---------------------------------------------------------------

def test_sign_up_shows_a_recovery_code_once(anonymous):
    r = anonymous.post("/auth/signup", json={"email": "you@example.com", "password": PASSWORD})
    code = r.json()["recovery_code"]
    assert re.fullmatch(r"[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}", code)
    assert _login(anonymous).json()["recovery_code"] is None              # not shown again


def test_older_accounts_get_a_code_at_their_next_login(anonymous):
    signed_up()
    with db.get_engine().begin() as conn:                                 # an account from before codes
        conn.execute(db.users.update().values(recovery_hash=None))
    assert _login(anonymous).json()["recovery_code"]
    assert _login(anonymous).json()["recovery_code"] is None


def test_a_recovery_code_sets_a_new_password_and_logs_out_other_devices(anonymous):
    phone = signed_up()
    code = phone.post("/auth/recovery-code", json={"password": PASSWORD}).json()["recovery_code"]
    r = anonymous.post("/auth/recover", json={"email": "You@example.com", "recovery_code": code.lower().replace("-", " "),
                                             "new_password": "a brand new password"})
    assert r.status_code == 200 and r.json()["recovery_code"] and r.json()["recovery_code"] != code
    assert phone.get("/portfolio").status_code == 401                     # the old login is out
    assert anonymous.get("/portfolio", headers=_bearer(r.json()["token"])).status_code == 200
    assert _login(anonymous, password="a brand new password").status_code == 200
    again = anonymous.post("/auth/recover", json={"email": "you@example.com", "recovery_code": code, "new_password": "x" * 12})
    assert again.status_code == 401                                       # each code works once


def test_wrong_recovery_codes_count_like_wrong_passwords(anonymous):
    signed_up()
    body = {"email": "you@example.com", "recovery_code": "AAAA-BBBB-CCCC-DDDD", "new_password": "a brand new password"}
    for _ in range(auth.MAX_FAILURES):
        assert anonymous.post("/auth/recover", json=body).status_code == 401
    assert anonymous.post("/auth/recover", json=body).status_code == 429
    assert _login(anonymous).status_code == 429                           # the email is locked for logins too


def test_making_a_new_code_needs_the_password(client):
    assert client.post("/auth/recovery-code", json={"password": "not it at all"}).status_code == 403
    assert client.post("/auth/recovery-code", json={"password": PASSWORD}).json()["recovery_code"]


# --- Passwords and devices -----------------------------------------------------------

def test_changing_the_password_logs_out_every_other_device(anonymous):
    phone, laptop = signed_up(), anonymous
    laptop.headers.update(_bearer(_login(laptop).json()["token"]))
    assert phone.post("/auth/password", json={"current_password": "wrong one!!", "new_password": "x" * 12}).status_code == 403
    r = phone.post("/auth/password", json={"current_password": PASSWORD, "new_password": "short"})
    assert r.status_code == 422
    r = phone.post("/auth/password", json={"current_password": PASSWORD, "new_password": "a brand new password"})
    assert r.status_code == 200
    assert laptop.get("/portfolio").status_code == 401
    assert phone.get("/portfolio", headers=_bearer(r.json()["token"])).status_code == 200
    assert _login(anonymous).status_code == 401


def test_log_out_other_devices(anonymous):
    phone, laptop = signed_up(), anonymous
    laptop.headers.update(_bearer(_login(laptop).json()["token"]))
    r = phone.post("/auth/logout-others")
    assert r.status_code == 200
    assert laptop.get("/portfolio").status_code == 401
    assert phone.get("/portfolio", headers=_bearer(r.json()["token"])).status_code == 200


def test_tokens_from_before_versions_still_work_until_a_log_out(client):
    token = client.headers["Authorization"].split()[1]
    user_id, version, expires, _ = token.split(".")
    old = f"{user_id}.{expires}"
    legacy = f"{old}.{auth._sign(old)}"                                  # how tokens looked before
    assert client.get("/portfolio", headers=_bearer(legacy)).status_code == 200
    client.post("/auth/logout-others")
    assert client.get("/portfolio", headers=_bearer(legacy)).status_code == 401


# --- Deleting an account -------------------------------------------------------------

def test_deleting_an_account_removes_everything(client, nvda):
    other = signed_up("other@example.com")
    assert other.post("/portfolio", json={"ticker": "NVDA", "shares": 100, "avg_cost": 10}).status_code == 201
    assert client.post("/auth/account/delete", json={"password": "not it at all"}).status_code == 403
    assert client.post("/auth/account/delete", json={"password": PASSWORD}).json() == {"deleted": True}
    assert client.get("/portfolio").status_code == 401
    with db.get_engine().connect() as conn:
        assert conn.execute(db.holdings.select().where(db.holdings.c.user_id == 1)).first() is None
    assert len(other.get("/portfolio").json()) == 1                       # nobody else's data
    assert _login(client).status_code == 401
    assert client.post("/auth/signup", json={"email": "you@example.com", "password": PASSWORD}).status_code == 201


# --- Limits ---------------------------------------------------------------------------

def test_lockouts_survive_a_restart(anonymous):
    signed_up()
    for _ in range(auth.MAX_FAILURES):
        _login(anonymous, password="nope nope nope")
    auth._versions.clear()
    db._engine.dispose()
    db._engine = None                                                     # a new server, same database
    assert _login(anonymous).status_code == 429


def test_one_network_can_only_guess_so_many_passwords(anonymous, monkeypatch):
    monkeypatch.setattr(auth, "MAX_IP_FAILURES", 3)
    for i in range(3):
        _login(anonymous, email=f"u{i}@example.com", password="nope")
    r = _login(anonymous, email="someone@example.com", password="nope")
    assert r.status_code == 429 and "from this network" in r.json()["detail"]
    r = anonymous.post("/auth/login", json={"email": "x@example.com", "password": "nope"}, headers={"X-Real-IP": "203.0.113.9"})
    assert r.status_code == 401                                           # another address isn't affected


def test_one_network_can_only_make_a_few_accounts_an_hour(anonymous):
    for i in range(auth.SIGNUPS_PER_IP_PER_HOUR):
        assert anonymous.post("/auth/signup", json={"email": f"u{i}@example.com", "password": PASSWORD}).status_code == 201
    r = anonymous.post("/auth/signup", json={"email": "late@example.com", "password": PASSWORD})
    assert r.status_code == 429 and "from this network" in r.json()["detail"]
