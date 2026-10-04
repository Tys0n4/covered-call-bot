# fees.py
"""
Your broker's commission per option contract, from the Strategy page
($0 by default: many brokers charge nothing for options). Estimates of what
you keep, buy-back costs and alerts all use it.
"""
from __future__ import annotations

from core.strategy import load_strategy


def typical_fee_per_contract() -> float:
    return load_strategy()["commission_per_contract"]
