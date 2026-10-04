# tests/test_buyback_price.py — options trade in whole cents, so the buy-back
# target becomes a price: the closest cent to (1 − target) × what you sold for
from datetime import date, timedelta

import pytest

from core.alerts import buyback_message
from core.buyback import buyback_price, evaluate_position

TODAY = "2026-10-05"


def _pos(entry, days=20):
    expiry = (date.fromisoformat(TODAY) + timedelta(days=days)).isoformat()
    return dict(ticker="NVDA", expiry=expiry, strike=110.0, contracts=9, entry_price=entry)


@pytest.mark.parametrize("entry,target,price", [
    (0.34, 85, 0.05),      # $0.051 → $0.05 (85.3% kept)
    (0.38, 85, 0.06),      # $0.057 → $0.06 (84.2%) is closer than $0.05 (86.8%)
    (0.40, 85, 0.06),      # exactly 85%
    (0.30, 85, 0.04),      # $0.045: exactly half a cent rounds down, keeping more
    (1.55, 65, 0.54),      # the earlier target before an event
    (0.03, 85, 0.01),      # never $0.00: an option can't be bought for nothing
    (0.0, 85, 0.0),
])
def test_buyback_price_is_the_closest_cent(entry, target, price):
    assert buyback_price(entry, target) == price


def test_buy_back_at_the_closest_cent_even_just_under_the_target():
    # Sold at $0.38: 85% kept would be $0.057; $0.06 is the closest real price
    r = evaluate_position(_pos(0.38), 0.06, today=TODAY, stock_price=100.0)
    assert r.action == "buy_back"
    assert (r.buyback_price, r.buyback_kept_pct) == (0.06, 84.2)
    assert r.profit_capture_pct == pytest.approx(84.21, abs=0.01)
    assert evaluate_position(_pos(0.38), 0.07, today=TODAY, stock_price=100.0).action == "hold"


def test_users_example_nine_contracts_at_34_cents():
    # $306 collected; 85% kept leaves $45.90 to buy back with: $0.05 ($45) is the closest
    r = evaluate_position(_pos(0.34), 0.06, today=TODAY, stock_price=100.0)
    assert (r.action, r.buyback_price, r.buyback_kept_pct) == ("hold", 0.05, 85.3)
    r = evaluate_position(_pos(0.34), 0.05, today=TODAY, stock_price=100.0)
    assert r.action == "buy_back"
    assert r.cost_to_close == pytest.approx(45.0)


def test_event_target_gets_its_own_price():
    fed = {"kind": "fed", "date": "2026-10-20"}
    r = evaluate_position(_pos(1.00), 0.35, today=TODAY, stock_price=100.0, event=fed)
    assert (r.action, r.target_pct, r.buyback_price) == ("buy_back", 65.0, 0.35)


def test_alert_names_the_price_to_buy_back_at():
    msg = buyback_message([dict(ticker="NVDA", strike=110.0, expiry="2026-10-25", contracts=9, entry_price=0.38,
                                current_price=0.06, profit_capture_pct=84.2, target_pct=85.0, cost_to_close=59.85,
                                buyback_price=0.06, buyback_kept_pct=84.2)])
    assert "Buy back at **$0.06**/share or less, the closest cent to your target (84.2% kept)" in msg["embeds"][0]["description"]


def test_manage_returns_the_buy_back_price(client, nvda):
    from core.market_hours import market_today
    expiry = (date.fromisoformat(market_today()) + timedelta(days=25)).isoformat()
    client.post("/positions", json=dict(ticker="NVDA", expiry=expiry, strike=125, contracts=1, entry_price=3.38,
                                        premium_total=338, allocation_type="Income"))
    e = client.get("/manage").json()["positions"][0]
    assert (e["buyback_price"], e["buyback_kept_pct"]) == (0.51, 84.9)     # $0.507 → $0.51


# --- Outside market hours: no recommendation from a trade before the latest session ----------

def test_positions_ignore_a_last_trade_from_days_ago(client, nvda, monkeypatch):
    import core.buyback as bb
    from conftest import TRADED_DAYS_AGO
    from core import cache
    from core.market_hours import last_session, market_today

    expiry = (date.fromisoformat(market_today()) + timedelta(days=25)).isoformat()
    client.post("/positions", json=dict(ticker="NVDA", expiry=expiry, strike=125, contracts=1, entry_price=25.0,
                                        premium_total=2500, allocation_type="Income"))
    real_get_calls = bb.get_calls

    def closed_market(ticker, expiry):                 # no bid/ask outside market hours
        calls = real_get_calls(ticker, expiry).copy()
        calls["bid"] = calls["ask"] = 0.0
        return calls
    monkeypatch.setattr(bb, "get_calls", closed_market)

    e = client.get("/manage").json()["positions"][0]
    assert e["action"] == "buy_back" and e["old_trade_date"] is None      # traded just now: its last price counts

    TRADED_DAYS_AGO["NVDA"] = {125.0: 10}
    cache.clear()
    e = client.get("/manage").json()["positions"][0]
    assert e["current_option_price"] == 0 and e["action"] == "hold" and not e["should_buy_back"]
    assert date.fromisoformat(e["old_trade_date"]) < last_session()
