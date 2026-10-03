# tests/test_edge.py — premium check (rich / normal / thin) and the comparison
# with just holding your shares
import math

import pandas as pd
import pytest
from conftest import HISTORY

from core.performance import compute_performance
from core.volatility import implied_volatility_near_money, realized_volatility


def _series(daily_move, days=40, start=100.0):
    """Closes that alternate up and down by daily_move (log), so realized vol is known."""
    closes, price = [start], start
    for i in range(days):
        price *= math.exp(daily_move if i % 2 == 0 else -daily_move)
        closes.append(price)
    return closes


def _annual(daily_move, window=20):
    return daily_move * math.sqrt(window / (window - 1)) * math.sqrt(252)


# --- 3. Premium check ----------------------------------------------------------

def test_realized_volatility_from_daily_closes():
    assert realized_volatility(_series(0.01)) == pytest.approx(_annual(0.01), rel=1e-6)
    assert realized_volatility([100.0] * 10) is None          # not enough history


def test_implied_volatility_uses_valid_near_money_options():
    calls = pd.DataFrame({"strike": [90, 100, 105, 150], "impliedVolatility": [0.30, 0.00001, 0.34, 0.90]})
    # 100's IV is junk (Yahoo outside market hours), 150 is too far from the price
    assert implied_volatility_near_money(calls, 100.0) == pytest.approx(0.32)


@pytest.mark.parametrize("realized,level", [(0.20, "rich"), (0.30, "normal"), (0.50, "thin")])
def test_scan_reports_whether_premiums_are_rich(client, nvda, realized, level):
    # Fake options are priced at 35% implied volatility
    HISTORY["NVDA"] = _series(realized / _annual(1.0))
    check = client.post("/scan", json={"ticker": "NVDA"}).json()["premium_check"]
    assert check["level"] == level
    assert check["implied_vol"] == pytest.approx(0.35)
    assert check["realized_vol"] == pytest.approx(realized, abs=0.001)


def test_no_premium_check_without_price_history(client, nvda):
    assert client.post("/scan", json={"ticker": "NVDA"}).json()["premium_check"] is None


# --- 4. Compared with just holding ---------------------------------------------------

def _p(id, status, premium, strike=120.0, closed="2026-09-30", **kw):
    p = dict(id=id, ticker="NVDA", status=status, premium_total=premium, strike=strike, contracts=1,
             expiry=closed, opened_at="2026-09-01", closed_at=closed,
             close_cost=0.0 if status in ("EXPIRED", "ASSIGNED") else None,
             open_fees=None, close_fees=None, cost_basis=100.0, rolled_from=None, allocation_type="Income")
    p.update(kw)
    return p


def test_covered_calls_vs_just_holding():
    positions = [
        _p(1, "EXPIRED", 200),                         # expired: capped nothing
        _p(2, "CLOSED", 300, close_cost=50),           # bought back: the cost already reflects the stock's rise
        _p(3, "ASSIGNED", 250, strike=120.0),          # called away at $120 when the stock closed at $130
    ]
    s = compute_performance(positions, {}, "2026-10-03", assignment_closes={3: 130.0})["summary"]
    assert s["upside_given_up"] == 1000                     # ($130 - $120) x 100 shares
    assert s["vs_holding"] == 200 + 250 + 250 - 1000        # premium kept minus upside given up
    assert s["upside_unknown"] == 0


def test_unknown_assignment_close_is_counted_not_guessed():
    s = compute_performance([_p(1, "ASSIGNED", 250)], {}, "2026-10-03")["summary"]
    assert s["upside_unknown"] == 1
    assert s["vs_holding"] == 250 and s["upside_given_up"] == 0


def test_performance_api_compares_with_holding(client, nvda):
    from conftest import CLOSES
    from datetime import date, timedelta
    expiry = (date.today() + timedelta(days=25)).isoformat()
    client.post("/positions", json=dict(ticker="NVDA", expiry=expiry, strike=110, contracts=1, entry_price=3.0,
                                        premium_total=300, allocation_type="Income"))
    pid = client.get("/positions").json()[0]["id"]
    assert client.post(f"/positions/{pid}/assign", json={}).status_code == 200
    closed_at = next(p for p in client.get("/positions/all").json() if p["id"] == pid)["closed_at"]
    CLOSES[("NVDA", closed_at[:10])] = 115.0
    s = client.get("/performance").json()["summary"]
    assert s["upside_given_up"] == 500 and s["vs_holding"] == 300 - 500
