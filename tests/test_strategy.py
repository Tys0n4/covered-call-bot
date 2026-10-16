# tests/test_strategy.py — how many contracts a trade covers: every free one, on one call
from core.planner import free_contracts


def test_free_contracts_count_every_open_call():
    open_calls = [{"contracts": 3, "status": "OPEN"}, {"contracts": 1, "status": "OPEN"}]
    assert free_contracts(1000, open_calls) == 6


def test_free_contracts_ignore_finished_calls_and_odd_lots():
    assert free_contracts(250, [{"contracts": 1, "status": "CLOSED"}]) == 2


def test_free_contracts_never_go_below_zero():
    # Shares were reduced after calls were sold
    assert free_contracts(200, [{"contracts": 3, "status": "OPEN"}]) == 0
