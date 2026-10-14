# tests/test_speed.py — the cache, side-by-side fetches, the expiry check and saved closes
import threading
import time
from datetime import date, timedelta

import pytest

from conftest import CLOSES
from core import cache, positions
from core.market_data import get_close_on
from core.market_hours import market_today
from core.parallel import parallel_map


def test_two_requests_for_the_same_thing_fetch_it_once():
    calls = []
    started = threading.Event()

    def slow():
        calls.append(1)
        started.set()
        time.sleep(0.2)
        return "answer"

    results = []
    first = threading.Thread(target=lambda: results.append(cache.cached(("k",), 60, slow)))
    first.start()
    started.wait(1)
    second = threading.Thread(target=lambda: results.append(cache.cached(("k",), 60, slow)))
    second.start()
    first.join()
    second.join()
    assert results == ["answer", "answer"]
    assert len(calls) == 1


def test_a_failed_fetch_lets_the_next_request_try_again():
    assert cache.cached(("k",), 60, lambda: None) is None
    assert cache.cached(("k",), 60, lambda: "ok") == "ok"


def test_expired_entries_are_dropped(monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(cache.time, "monotonic", lambda: clock[0])
    cache.cached(("old",), 10, lambda: 1)
    clock[0] += cache.SWEEP_EVERY + 1                # long past its 10 seconds
    cache.cached(("new",), 10, lambda: 2)
    assert ("old",) not in cache._store and ("new",) in cache._store


def test_parallel_map_keeps_the_order_and_raises_errors():
    assert parallel_map(lambda n: n * 2, [3, 1, 2]) == [6, 2, 4]
    assert parallel_map(lambda n: n, []) == []

    def boom(n):
        if n == 2:
            raise ValueError("no")
        return n
    with pytest.raises(ValueError):
        parallel_map(boom, [1, 2, 3])


def test_price_check_returns_one_result_per_call_in_order(client, nvda):
    client.post("/portfolio", json={"ticker": "AAPL", "shares": 200, "avg_cost": 150})
    expiry = (date.fromisoformat(market_today()) + timedelta(days=25)).isoformat()
    for ticker, strike in (("NVDA", 120), ("AAPL", 230), ("NVDA", 125)):
        r = client.post("/positions", json=dict(ticker=ticker, expiry=expiry, strike=strike, contracts=1,
                                                entry_price=2.0, allocation_type="Income"))
        assert r.status_code == 201, r.text
    got = client.get("/manage").json()["positions"]
    assert sorted((p["ticker"], p["strike"]) for p in got) == [("AAPL", 230), ("NVDA", 120), ("NVDA", 125)]
    assert all(p["stock_price"] for p in got)


def test_the_expiry_check_runs_once_a_minute_unless_calls_change(client, nvda):
    positions.expire_finished_positions(force=True)
    calls = []
    real_update = positions.update
    positions.update = lambda *a, **k: calls.append(1) or real_update(*a, **k)
    try:
        client.get("/positions")
        client.get("/positions/all")
        assert calls == []                         # just ran: skipped
        positions._calls_changed()
        client.get("/positions")
        assert len(calls) == 1                     # a call changed: runs again
        positions._last_expire["at"] -= positions.EXPIRE_EVERY
        client.get("/positions")
        assert len(calls) == 2                     # a minute later: runs again
    finally:
        positions.update = real_update


def test_a_call_saved_already_expired_is_closed_on_the_next_read(client, nvda):
    client.get("/positions")                      # the check has just run
    past = (date.today() - timedelta(days=3)).isoformat()
    r = client.post("/positions", json=dict(ticker="NVDA", expiry=past, strike=120, contracts=1,
                                            entry_price=1.0, allocation_type="Income"))
    assert r.status_code == 201
    assert client.get("/positions").json() == []
    assert [p["status"] for p in client.get("/positions/all").json()] == ["EXPIRED"]


def test_a_past_close_is_saved_and_not_downloaded_again():
    day = (date.today() - timedelta(days=10)).isoformat()
    CLOSES[("NVDA", day)] = 101.5
    assert get_close_on("NVDA", day) == 101.5
    CLOSES.clear()                                # Yahoo no longer has it
    cache.clear()                                 # e.g. a redeploy
    assert get_close_on("NVDA", day) == 101.5


def test_todays_close_is_not_saved():
    today = market_today()
    CLOSES[("NVDA", today)] = 99.0
    assert get_close_on("NVDA", today) == 99.0
    CLOSES.clear()
    cache.clear()
    assert get_close_on("NVDA", today) is None


def test_the_strategy_is_kept_in_memory_and_saving_updates_it(client):
    from sqlalchemy import event
    from core import db, strategy
    client.get("/settings")
    seen = []
    event.listen(db.get_engine(), "before_cursor_execute", lambda *a, **k: seen.append(a[2]))
    assert client.get("/settings").json()["monthly_goal"] == 0
    assert seen == []                                     # from memory
    body = {**client.get("/settings").json(), "monthly_goal": 1500}
    assert client.put("/settings", json=body).status_code == 200
    seen.clear()
    assert strategy.load_strategy()["monthly_goal"] == 1500 and seen == []
    strategy._kept["at"] -= strategy.STRATEGY_TTL         # a minute later: read again
    assert strategy.load_strategy()["monthly_goal"] == 1500 and len(seen) == 1
