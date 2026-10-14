# tests/test_scan_all.py — POST /scan/all: every stock with free contracts in one scan
from datetime import date, timedelta

import pytest

from core import scanner
from core.market_hours import market_today


@pytest.fixture
def aapl(client):
    """300 AAPL shares (3 contracts) bought at $180."""
    r = client.post("/portfolio", json={"ticker": "AAPL", "shares": 300, "avg_cost": 180})
    assert r.status_code == 201, r.text


def test_scans_every_stock_with_free_contracts(client, nvda, aapl):
    r = client.post("/scan/all", json={})
    assert r.status_code == 200, r.text
    body = r.json()
    assert {i["ticker"] for i in body["scanned"]} == {"NVDA", "AAPL"}
    assert body["covered"] == []
    by = {i["ticker"]: i for i in body["scanned"]}
    assert (by["NVDA"]["available"], by["AAPL"]["available"]) == (5, 3)
    # The same answer as scanning each stock alone
    alone = client.post("/scan", json={"ticker": "NVDA"}).json()
    assert by["NVDA"]["result"]["planned_positions"] == alone["planned_positions"]
    premiums = [i["result"]["gross_premium"] for i in body["scanned"]]
    assert premiums == sorted(premiums, reverse=True)


def test_stocks_with_every_contract_sold_are_not_scanned(client, nvda, aapl):
    expiry = (date.fromisoformat(market_today()) + timedelta(days=25)).isoformat()
    r = client.post("/positions", json=dict(ticker="AAPL", expiry=expiry, strike=230, contracts=3,
                                            entry_price=2.0, allocation_type="Income"))
    assert r.status_code == 201
    body = client.post("/scan/all", json={}).json()
    assert [i["ticker"] for i in body["scanned"]] == ["NVDA"]
    assert body["covered"] == ["AAPL"]


def test_under_100_shares_is_neither_scanned_nor_covered(client, nvda):
    client.post("/portfolio", json={"ticker": "AAPL", "shares": 50, "avg_cost": 180})
    body = client.post("/scan/all", json={}).json()
    assert [i["ticker"] for i in body["scanned"]] == ["NVDA"]
    assert body["covered"] == []


def test_one_stock_failing_doesnt_stop_the_rest(client, nvda, aapl, monkeypatch):
    real = scanner.scan_covered_calls

    def flaky(position, **kw):
        if position.ticker == "AAPL":
            raise RuntimeError("network down")
        return real(position, **kw)
    monkeypatch.setattr("api.routes.scan.scan_covered_calls", flaky)
    body = client.post("/scan/all", json={}).json()
    by = {i["ticker"]: i for i in body["scanned"]}
    assert by["NVDA"]["result"]["planned_positions"]
    assert by["AAPL"]["result"] is None and "Couldn't scan AAPL" in by["AAPL"]["error"]
    assert body["scanned"][-1]["ticker"] == "AAPL"            # no trade: listed last


def test_a_stock_without_a_price_says_so(client, nvda, aapl, monkeypatch):
    real = scanner.get_price_quote
    monkeypatch.setattr(scanner, "get_price_quote", lambda t: (None, None) if t == "AAPL" else real(t))
    by = {i["ticker"]: i for i in client.post("/scan/all", json={}).json()["scanned"]}
    assert by["AAPL"]["error"] == "Could not fetch AAPL's current price."


def test_the_filters_apply_to_every_stock(client, nvda, aapl):
    body = client.post("/scan/all", json={"min_strike_pct": 0.2}).json()
    for item in body["scanned"]:
        r = item["result"]
        assert all(c["strike"] >= r["current_price"] * 1.2 - 1e-6 for c in r["candidates"])


def test_scan_all_rejects_nonsense_filters(client, nvda):
    assert client.post("/scan/all", json={"min_dte": 50, "max_dte": 10}).status_code == 422
