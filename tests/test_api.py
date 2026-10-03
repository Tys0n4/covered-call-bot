# tests/test_api.py — end-to-end API tests against the fake market in conftest.py
from datetime import date, timedelta

import pytest

import api.auth as auth


def _expiry(days=25):
    return (date.today() + timedelta(days=days)).isoformat()


def _trade(**over):
    t = dict(ticker="NVDA", expiry=_expiry(), strike=125, contracts=1,
             entry_price=2.0, premium_total=200, allocation_type="Income")
    t.update(over)
    return t


def _save_payload(scan):
    return [
        {k: p[k] for k in ("expiry", "strike", "contracts", "entry_price", "premium_total", "allocation_type")}
        | {"ticker": scan["ticker"]}
        for p in scan["planned_positions"]
    ]


def _open_contracts(client, ticker="NVDA"):
    return sum(p["contracts"] for p in client.get("/positions", params={"ticker": ticker}).json())


# --- Auth --------------------------------------------------------------------

def test_api_is_open_without_password(client):
    assert client.get("/auth/status").json() == {"auth_required": False}
    assert client.get("/portfolio").status_code == 200


def test_password_protects_every_data_route(client, monkeypatch):
    monkeypatch.setenv("APP_PASSWORD", "hunter2")
    monkeypatch.setattr(auth.time, "sleep", lambda s: None)

    assert client.get("/health").status_code == 200
    assert client.get("/auth/status").json() == {"auth_required": True}
    for method, url in [("get", "/portfolio"), ("get", "/positions"), ("get", "/manage"),
                        ("get", "/settings"), ("post", "/scan"), ("delete", "/portfolio/AAPL")]:
        assert getattr(client, method)(url).status_code == 401, url

    assert client.post("/auth/login", json={"password": "nope"}).status_code == 401
    token = client.post("/auth/login", json={"password": "hunter2"}).json()["token"]
    assert client.get("/portfolio", headers={"Authorization": f"Bearer {token}"}).status_code == 200

    tampered = token[:-1] + ("A" if token[-1] != "A" else "B")
    assert client.get("/portfolio", headers={"Authorization": f"Bearer {tampered}"}).status_code == 401


def test_expired_and_rotated_tokens_are_rejected(monkeypatch):
    monkeypatch.setenv("APP_PASSWORD", "hunter2")
    token, expires = auth.make_token()
    assert auth.token_is_valid(token)
    assert not auth.token_is_valid(token, now=expires + 1)
    monkeypatch.setenv("APP_PASSWORD", "changed")   # new password logs old sessions out
    assert not auth.token_is_valid(token)


# --- Scan ----------------------------------------------------------------------

def test_scan_unknown_ticker_is_404_not_another_stock(client, nvda):
    r = client.post("/scan", json={"ticker": "AAPL"})
    assert r.status_code == 404
    assert "not in your portfolio" in r.json()["detail"]


@pytest.mark.parametrize("bad", [
    {"min_strike_pct": -5},
    {"target_delta": 0},
    {"min_dte": 50, "max_dte": 10},
    {"min_premium": -1},
    {"ticker": "bad ticker!"},
])
def test_scan_rejects_nonsense_filters(client, nvda, bad):
    assert client.post("/scan", json={"ticker": "NVDA", **bad}).status_code == 422


def test_scan_flags_strikes_below_cost_basis(client, nvda):
    scan = client.post("/scan", json={"ticker": "NVDA"}).json()
    assert scan["avg_cost"] == 130
    below = [c for c in scan["candidates"] if c["below_cost_basis"]]
    assert below and all(c["strike"] < 130 for c in below)
    assert all(not c["below_cost_basis"] for c in scan["candidates"] if c["strike"] >= 130)
    assert any("below your $130.00 average cost" in w for w in scan["warnings"])
    assert any(p["below_cost_basis"] for p in scan["planned_positions"])


def test_scan_can_skip_strikes_below_cost(client, nvda):
    scan = client.post("/scan", json={"ticker": "NVDA", "exclude_below_cost": True}).json()
    assert scan["candidates"]
    assert all(c["strike"] >= 130 for c in scan["candidates"])
    assert scan["min_strike"] == 130


# --- Saving trades ---------------------------------------------------------------

def test_saving_a_scan_twice_is_refused(client, nvda):
    scan = client.post("/scan", json={"ticker": "NVDA"}).json()
    payload = _save_payload(scan)
    assert sum(p["contracts"] for p in payload) == 5

    assert client.post("/scan/save", json=payload).status_code == 200
    again = client.post("/scan/save", json=payload)
    assert again.status_code == 409
    assert _open_contracts(client) == 5


def test_cannot_sell_more_calls_than_shares_cover(client, nvda):
    r = client.post("/scan/save", json=[_trade(contracts=999)])
    assert r.status_code == 409
    assert "cover 5 contracts" in r.json()["detail"]
    r = client.post("/positions", json=_trade(contracts=6))
    assert r.status_code == 409
    assert _open_contracts(client) == 0


def test_manual_add_counts_existing_calls(client, nvda):
    assert client.post("/positions", json=_trade(contracts=4)).status_code == 201
    assert client.post("/positions", json=_trade(contracts=2)).status_code == 409
    assert client.post("/positions", json=_trade(contracts=1)).status_code == 201
    assert _open_contracts(client) == 5


def test_calls_on_stock_not_owned_are_refused(client, nvda):
    r = client.post("/positions", json=_trade(ticker="AAPL"))
    assert r.status_code == 409
    assert "not in your portfolio" in r.json()["detail"]


@pytest.mark.parametrize("bad", [
    {"contracts": -5}, {"contracts": 0}, {"strike": -1}, {"entry_price": -2},
    {"allocation_type": "Yolo"}, {"expiry": "not-a-date"}, {"ticker": "bad ticker!"},
])
def test_trade_validation(client, nvda, bad):
    assert client.post("/positions", json=_trade(**bad)).status_code == 422
    assert client.post("/scan/save", json=[_trade(**bad)]).status_code == 422


def test_malformed_save_is_422_not_500(client, nvda):
    assert client.post("/scan/save", json=[{"ticker": "NVDA"}]).status_code == 422
    assert client.post("/scan/save", json=[]).status_code == 422


def test_manual_add_keeps_opened_date(client, nvda):
    client.post("/positions", json=_trade(opened_at="2026-01-15"))
    assert client.get("/positions").json()[0]["opened_at"] == "2026-01-15"


# --- Check prices ------------------------------------------------------------------

def test_manage_keeps_ids_for_positions_on_the_same_option(client, nvda):
    for _ in range(3):
        assert client.post("/positions", json=_trade()).status_code == 201
    open_ids = sorted(p["id"] for p in client.get("/positions").json())
    evaluated = client.get("/manage", params={"ticker": "NVDA"}).json()["positions"]
    assert sorted(e["id"] for e in evaluated) == open_ids
    assert all(e["current_option_price"] > 0 for e in evaluated)


def test_scan_explains_unreachable_target_delta(client, nvda):
    # 20%+ above price leaves only tiny deltas in the fake market
    far = client.post("/scan", json={"ticker": "NVDA"}).json()
    assert any("No option comes close to your 0.22" in w for w in far["warnings"])
    near = client.post("/scan", json={"ticker": "NVDA", "min_strike_pct": 0.02}).json()
    assert not any("No option comes close" in w for w in near["warnings"])
