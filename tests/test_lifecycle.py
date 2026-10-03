# tests/test_lifecycle.py — fills, fees, rolls, assignment and the assignment review
from datetime import date, timedelta

from sqlalchemy import update

import db
from conftest import CLOSES


def _expiry(days=25):
    return (date.today() + timedelta(days=days)).isoformat()


def _sell(client, **over):
    t = dict(ticker="NVDA", expiry=_expiry(), strike=125, contracts=2, entry_price=2.10,
             allocation_type="Income", fees=1.30)
    t.update(over)
    r = client.post("/positions", json=t)
    assert r.status_code == 201, r.text
    return max(p["id"] for p in client.get("/positions").json())


def _position(client, pid):
    return next(p for p in client.get("/positions/all").json() if p["id"] == pid)


def _shares(client, ticker="NVDA"):
    return next(h["shares"] for h in client.get("/portfolio").json() if h["ticker"] == ticker)


def _expire(pid, days_ago=3):
    """Pretend the call expired a few days ago."""
    day = (date.today() - timedelta(days=days_ago)).isoformat()
    with db.get_engine().begin() as conn:
        conn.execute(update(db.positions).where(db.positions.c.id == pid).values(expiry=day))
    return day


# --- Fills and fees -------------------------------------------------------------

def test_premium_comes_from_the_fill_price_and_fees_are_kept(client, nvda):
    pid = _sell(client, entry_price=2.10, contracts=2, fees=1.30, premium_total=999999)
    p = _position(client, pid)
    assert p["premium_total"] == 420.0          # 2.10 x 2 x 100, not what the client sent
    assert p["open_fees"] == 1.30
    assert p["cost_basis"] == 130.0              # avg cost recorded when sold


def test_close_records_fees(client, nvda):
    pid = _sell(client)
    r = client.post("/positions/close", json={"position_id": pid, "close_cost": 84, "close_fees": 1.30})
    assert r.status_code == 200
    p = _position(client, pid)
    assert (p["status"], p["close_cost"], p["close_fees"]) == ("CLOSED", 84.0, 1.30)


# --- Rolling ----------------------------------------------------------------------

def test_roll_closes_the_old_call_and_opens_the_new_one(client, nvda):
    old = _sell(client, contracts=5, allocation_type="Balanced")
    r = client.post(f"/positions/{old}/roll", json={
        "close_cost": 300, "close_fees": 3.25, "expiry": _expiry(60), "strike": 130,
        "contracts": 5, "entry_price": 1.80, "open_fees": 3.25,
    })
    assert r.status_code == 200, r.text
    new = r.json()["opened"]
    o, n = _position(client, old), _position(client, new)
    assert (o["status"], o["close_cost"], o["close_fees"]) == ("CLOSED", 300.0, 3.25)
    assert (n["status"], n["rolled_from"], n["ticker"], n["allocation_type"]) == ("OPEN", old, "NVDA", "Balanced")
    assert (n["premium_total"], n["open_fees"], n["strike"]) == (900.0, 3.25, 130.0)


def test_roll_cannot_add_uncovered_contracts(client, nvda):
    old = _sell(client, contracts=5)
    r = client.post(f"/positions/{old}/roll", json={
        "close_cost": 100, "expiry": _expiry(60), "strike": 130, "contracts": 6, "entry_price": 1,
    })
    assert r.status_code == 409
    assert _position(client, old)["status"] == "OPEN"     # nothing changed


def test_roll_to_a_past_expiry_is_refused(client, nvda):
    old = _sell(client)
    r = client.post(f"/positions/{old}/roll", json={
        "close_cost": 100, "expiry": "2020-01-17", "strike": 130, "contracts": 2, "entry_price": 1,
    })
    assert r.status_code == 422
    assert _position(client, old)["status"] == "OPEN"


def test_roll_unknown_or_closed_position_is_404(client, nvda):
    body = {"close_cost": 1, "expiry": _expiry(60), "strike": 130, "contracts": 1, "entry_price": 1}
    assert client.post("/positions/9999/roll", json=body).status_code == 404


# --- Assignment ---------------------------------------------------------------------

def test_early_assignment_removes_the_shares(client, nvda):
    pid = _sell(client, contracts=2)
    r = client.post(f"/positions/{pid}/assign", json={})
    assert r.status_code == 200, r.text
    p = r.json()
    assert (p["status"], p["close_cost"], p["cost_basis"]) == ("ASSIGNED", 0.0, 130.0)
    assert _shares(client) == 300


def test_expired_call_can_be_marked_assigned_on_its_expiry(client, nvda):
    pid = _sell(client, contracts=1)
    day = _expire(pid)
    assert _position(client, pid)["status"] == "EXPIRED"
    p = client.post(f"/positions/{pid}/assign").json()
    assert (p["status"], p["closed_at"]) == ("ASSIGNED", day)
    assert _shares(client) == 400


def test_assignment_keeps_other_open_calls_covered(client, nvda):
    first = _sell(client, contracts=1)
    _expire(first)                      # its shares are free again...
    _sell(client, contracts=5)          # ...so all 5 contracts got sold again
    r = client.post(f"/positions/{first}/assign")
    assert r.status_code == 409
    assert "not enough for your other 5 open call" in r.json()["detail"]
    assert _shares(client) == 500


def test_cannot_assign_twice(client, nvda):
    pid = _sell(client, contracts=1)
    assert client.post(f"/positions/{pid}/assign").status_code == 200
    assert client.post(f"/positions/{pid}/assign").status_code == 404
    assert _shares(client) == 400


# --- Assignment review ----------------------------------------------------------------

def test_review_lists_calls_that_expired_in_the_money(client, nvda):
    itm = _sell(client, contracts=1, strike=125)
    otm = _sell(client, contracts=1, strike=140)
    unknown = _sell(client, contracts=1, strike=150)
    day = _expire(itm)
    _expire(otm)
    _expire(unknown, days_ago=4)
    CLOSES[("NVDA", day)] = 131.0      # above 125, below 140; no close known for `unknown`

    review = client.get("/positions/assignment-review").json()
    assert [(r["id"], r["close_price"]) for r in review] == [(itm, 131.0)]

    assert client.post(f"/positions/{itm}/not-assigned").status_code == 200
    assert client.get("/positions/assignment-review").json() == []
    assert _shares(client) == 500


# --- Editing ------------------------------------------------------------------------

def test_edit_fill_recomputes_premium(client, nvda):
    pid = _sell(client, entry_price=2.10, contracts=2, fees=0)
    r = client.patch(f"/positions/{pid}", json={"entry_price": 2.35, "open_fees": 1.30})
    assert r.status_code == 200, r.text
    p = r.json()
    assert (p["entry_price"], p["premium_total"], p["open_fees"]) == (2.35, 470.0, 1.30)


def test_add_missing_buyback_cost(client, nvda):
    pid = _sell(client)
    client.post("/positions/close", json={"position_id": pid})              # no cost entered
    assert _position(client, pid)["close_cost"] is None
    p = client.patch(f"/positions/{pid}", json={"close_cost": 84, "close_fees": 1.3}).json()
    assert (p["close_cost"], p["close_fees"]) == (84.0, 1.3)


def test_buyback_cost_only_on_bought_back_calls(client, nvda):
    pid = _sell(client)
    assert client.patch(f"/positions/{pid}", json={"close_cost": 10}).status_code == 422
    assert client.patch(f"/positions/{pid}", json={}).status_code == 422
    assert client.patch("/positions/9999", json={"open_fees": 1}).status_code == 404


# --- Undo -------------------------------------------------------------------------------

def test_undo_buyback_reopens_the_call(client, nvda):
    pid = _sell(client)
    client.post("/positions/close", json={"position_id": pid, "close_cost": 50, "close_fees": 1})
    r = client.post(f"/positions/{pid}/undo")
    assert r.status_code == 200, r.text
    p = _position(client, pid)
    assert (p["status"], p["closed_at"], p["close_cost"], p["close_fees"]) == ("OPEN", None, None, None)


def test_undo_buyback_checks_coverage(client, nvda):
    pid = _sell(client, contracts=3)
    client.post("/positions/close", json={"position_id": pid, "close_cost": 50})
    _sell(client, contracts=5)                       # shares were used again
    r = client.post(f"/positions/{pid}/undo")
    assert r.status_code == 409
    assert _position(client, pid)["status"] == "CLOSED"


def test_undo_roll_removes_the_new_call(client, nvda):
    old = _sell(client, contracts=5)
    new = client.post(f"/positions/{old}/roll", json={
        "close_cost": 100, "expiry": _expiry(60), "strike": 130, "contracts": 5, "entry_price": 1,
    }).json()["opened"]
    r = client.post(f"/positions/{old}/undo").json()
    assert r["removed"] == new
    assert _position(client, old)["status"] == "OPEN"
    assert all(p["id"] != new for p in client.get("/positions/all").json())


def test_cannot_undo_roll_once_new_call_finished(client, nvda):
    old = _sell(client)
    new = client.post(f"/positions/{old}/roll", json={
        "close_cost": 100, "expiry": _expiry(60), "strike": 130, "contracts": 2, "entry_price": 1,
    }).json()["opened"]
    client.post("/positions/close", json={"position_id": new, "close_cost": 10})
    r = client.post(f"/positions/{old}/undo")
    assert r.status_code == 409 and "Undo that one first" in r.json()["detail"]


def test_undo_early_assignment_returns_shares(client, nvda):
    pid = _sell(client, contracts=2)
    client.post(f"/positions/{pid}/assign")
    assert _shares(client) == 300
    r = client.post(f"/positions/{pid}/undo").json()
    assert (r["status"], r["shares_returned"]) == ("OPEN", 200)
    assert _shares(client) == 500
    assert _position(client, pid)["status"] == "OPEN"


def test_undo_assignment_after_expiry_goes_back_to_expired(client, nvda):
    pid = _sell(client, contracts=1)
    _expire(pid)
    client.post(f"/positions/{pid}/assign")
    r = client.post(f"/positions/{pid}/undo").json()
    assert r["status"] == "EXPIRED"
    assert _shares(client) == 500
    assert client.get("/positions/assignment-review").json() == []   # not asked again


def test_undo_assignment_when_holding_was_removed(client, nvda):
    pid = _sell(client, contracts=5)
    client.post(f"/positions/{pid}/assign")          # all 500 shares gone
    assert client.delete("/portfolio/NVDA").status_code == 200
    client.post(f"/positions/{pid}/undo")
    h = next(h for h in client.get("/portfolio").json() if h["ticker"] == "NVDA")
    assert (h["shares"], h["avg_cost"]) == (500, 130.0)


def test_nothing_to_undo_on_open_or_expired(client, nvda):
    pid = _sell(client)
    assert client.post(f"/positions/{pid}/undo").status_code == 409
    _expire(pid)
    assert client.post(f"/positions/{pid}/undo").status_code == 409
