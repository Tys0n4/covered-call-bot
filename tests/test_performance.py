# tests/test_performance.py — realized results math
import pytest

from performance import compute_performance, trade_result


def _p(id, status, premium, opened="2026-09-01", closed="2026-09-30", **kw):
    p = dict(id=id, ticker="NVDA", status=status, premium_total=premium, strike=120.0, contracts=1,
             expiry=closed, opened_at=opened, closed_at=None if status == "OPEN" else closed,
             close_cost=0.0 if status in ("EXPIRED", "ASSIGNED") else None,
             open_fees=None, close_fees=None, cost_basis=100.0, rolled_from=None, allocation_type="Income")
    p.update(kw)
    return p


def test_bought_back_call_net_and_returns():
    t = trade_result(_p(1, "CLOSED", 300, close_cost=60, open_fees=1.3, close_fees=1.3), {})
    assert t["option_net"] == pytest.approx(237.4)          # 300 - 60 - 2.60
    assert t["capital"] == 10_000                           # $100 basis x 100 shares
    assert t["days_held"] == 29
    assert t["return_pct"] == pytest.approx(2.37, abs=0.01)
    assert t["annualized_pct"] == pytest.approx(29.9, abs=0.1)


def test_unknown_buyback_cost_is_not_guessed():
    t = trade_result(_p(1, "CLOSED", 300), {})
    assert t["option_net"] is None and t["return_pct"] is None


def test_assignment_records_share_gain_from_cost_basis():
    t = trade_result(_p(1, "ASSIGNED", 250, strike=120.0, cost_basis=100.0), {})
    assert t["option_net"] == 250
    assert t["share_gain"] == 2000                          # (120 - 100) x 100


def test_falls_back_to_current_avg_cost_for_old_trades():
    t = trade_result(_p(1, "ASSIGNED", 250, cost_basis=None), {"NVDA": 110.0})
    assert t["share_gain"] == 1000 and t["capital"] == 11_000


def test_summary_and_months():
    positions = [
        _p(1, "EXPIRED", 200, closed="2026-09-19"),
        _p(2, "CLOSED", 300, close_cost=400, closed="2026-10-02"),     # a loss
        _p(3, "CLOSED", 500, closed="2026-10-01"),                      # cost not entered
        _p(4, "ASSIGNED", 100, closed="2026-10-02"),
        _p(5, "OPEN", 150, open_fees=1.5),
        _p(6, "OPEN", 90, rolled_from=2),
    ]
    r = compute_performance(positions, {}, today="2026-10-03")
    s = r["summary"]
    assert s["month"] == "2026-10"
    assert s["realized_this_month"] == 0          # -100 + 100
    assert s["realized_this_year"] == 200
    assert s["realized_all_time"] == 200
    assert s["share_gains_all_time"] == 2000
    assert s["win_rate_pct"] == pytest.approx(66.7)
    assert (s["calls_finished"], s["missing_costs"]) == (4, 1)
    assert (s["open_calls"], s["open_premium"]) == (2, 238.5)

    oct_, sep = r["months"]
    assert oct_["month"] == "2026-10" and oct_["calls"] == 3 and oct_["missing_costs"] == 1
    assert oct_["option_net"] == 0 and oct_["share_gains"] == 2000
    assert oct_["premium"] == 900                  # 300 + 500 (cost unknown) + 100
    assert sep == {**sep, "month": "2026-09", "calls": 1, "option_net": 200}

    assert [t["id"] for t in r["trades"]] == [4, 2, 3, 1]
    assert next(t for t in r["trades"] if t["id"] == 2)["rolled"] is True


def test_empty_history():
    s = compute_performance([], {}, "2026-10-03")["summary"]
    assert s["realized_all_time"] == 0 and s["annualized_return_pct"] is None and s["win_rate_pct"] is None


def test_endpoint(client, nvda):
    client.post("/positions", json=dict(ticker="NVDA", expiry="2030-01-18", strike=125, contracts=1,
                                        entry_price=3, allocation_type="Income", fees=1))
    r = client.get("/performance").json()
    assert r["summary"]["open_calls"] == 1 and r["summary"]["open_premium"] == 299
    assert r["trades"] == []
