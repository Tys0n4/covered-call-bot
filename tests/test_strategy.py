# tests/test_strategy.py — the split and allocation math
import pytest

from strategy import allocation_targets, split_contracts


@pytest.mark.parametrize("total, weight, expected", [
    (10, 0.7, (7, 3)),
    (5, 0.5, (3, 2)),     # exact half goes to Income
    (1, 0.7, (1, 0)),
    (0, 0.7, (0, 0)),
    (4, 0.0, (0, 4)),
    (4, 1.0, (4, 0)),
])
def test_split_contracts(total, weight, expected):
    assert split_contracts(total, weight) == expected


def test_allocation_targets_fill_the_gap():
    t = allocation_targets(10, open_income=3, open_balanced=0, income_weight=0.7)
    assert (t["needed_income"], t["needed_balanced"], t["available"]) == (4, 3, 7)


def test_allocation_targets_never_exceed_free_contracts():
    # Split changed while 8 balanced calls are open: only 2 contracts are free
    t = allocation_targets(10, open_income=0, open_balanced=8, income_weight=0.7)
    assert (t["needed_income"], t["needed_balanced"], t["available"]) == (2, 0, 2)


def test_allocation_targets_when_fully_used():
    t = allocation_targets(5, open_income=4, open_balanced=1, income_weight=0.7)
    assert t["available"] == 0
