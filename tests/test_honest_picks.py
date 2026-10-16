# tests/test_honest_picks.py — what the Scanner needs to be honest about a trade (the bid
# and ask behind "about $585", the account type behind the tax line) and the record that
# answers "did following CovCall help?"
from core import db


def _scan(client):
    r = client.post("/scan", json={"ticker": "NVDA"})
    assert r.status_code == 200, r.text
    return r.json()


def _save(client, scan, pick, contracts=1, price=2.0):
    """Record a trade from this scan: `pick` is the call sold; the recommendation goes with it."""
    rec = scan["planned_positions"][0]
    trade = {"ticker": "NVDA", "expiry": pick["expiry"], "strike": pick["strike"], "contracts": contracts,
             "entry_price": price, "allocation_type": "Income",
             "recommended_expiry": rec["expiry"], "recommended_strike": rec["strike"]}
    assert client.post("/scan/save", json=[trade]).status_code == 200
    return next(p["id"] for p in client.get("/positions").json()
                if p["expiry"] == pick["expiry"] and p["strike"] == pick["strike"])


def test_each_call_carries_its_bid_and_ask(client, nvda):
    c = _scan(client)["candidates"][0]
    assert c["bid"] is not None and c["ask"] is not None and c["bid"] <= c["ask"]


def test_the_recommendation_is_saved_with_the_trade(client, nvda):
    scan = _scan(client)
    rec = scan["planned_positions"][0]
    _save(client, scan, rec)
    with db.get_engine().connect() as conn:
        row = conn.execute(db.positions.select()).mappings().first()
    assert (row["recommended_expiry"], row["recommended_strike"]) == (rec["expiry"], rec["strike"])


def test_performance_splits_followed_picks_from_other_calls(client, nvda):
    scan = _scan(client)
    rec = scan["planned_positions"][0]
    other = next(c for c in scan["candidates"] if (c["expiry"], c["strike"]) != (rec["expiry"], rec["strike"]))
    followed_id = _save(client, scan, rec, contracts=2, price=2.0)          # $400
    other_id = _save(client, scan, other, contracts=1, price=1.5)          # $150
    assert client.post("/positions", json={"ticker": "NVDA", "expiry": rec["expiry"], "strike": 200, "contracts": 1,
                                           "entry_price": 1, "allocation_type": "Income"}).status_code == 201  # by hand
    advice = client.get("/performance").json()["advice"]
    assert advice["open"] == 2 and advice["followed"]["calls"] == 0          # nothing finished yet

    client.post("/positions/close", json={"position_id": followed_id, "close_cost": 60})
    client.post("/positions/close", json={"position_id": other_id, "close_cost": 100})
    advice = client.get("/performance").json()["advice"]
    assert advice["followed"] == {"calls": 1, "kept": 340.0, "unknown": 0, "shares_sold": 0}
    assert advice["other"] == {"calls": 1, "kept": 50.0, "unknown": 0, "shares_sold": 0}
    assert advice["open"] == 0 and advice["since"]


def test_calls_added_by_hand_are_not_counted(client, nvda):
    r = client.post("/positions", json={"ticker": "NVDA", "expiry": _scan(client)["planned_positions"][0]["expiry"],
                                        "strike": 200, "contracts": 1, "entry_price": 1, "allocation_type": "Income"})
    assert r.status_code == 201
    advice = client.get("/performance").json()["advice"]
    assert advice["open"] == 0 and advice["since"] is None


def test_the_tax_account_type_is_part_of_the_strategy(client):
    s = client.get("/settings").json()
    assert s["tax_account"] == "taxable"
    assert client.put("/settings", json={**s, "tax_account": "retirement"}).json()["tax_account"] == "retirement"
    assert client.get("/settings").json()["tax_account"] == "retirement"
    assert client.put("/settings", json={**s, "tax_account": "offshore"}).status_code == 422
