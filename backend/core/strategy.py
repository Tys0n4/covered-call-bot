# strategy.py
"""
Your strategy settings (edited on the Strategy page), stored in the database.

- income_weight:             share of each stock's contracts sold as Income picks
- profit_capture_target_pct: say "Buy back now" once this % of the premium is kept
- buyback_budget_pct:        part of each premium set aside for buying calls back
- monthly_goal:              premium goal per month in dollars (0 = off)
- delta_min / delta_max:     sell calls with this chance of being called (0.20–0.30)
- min_dte / max_dte:         expiries this many days out (14–30)
- event_buyback_pct:         buy back at this % kept when earnings or a Fed meeting comes before expiry
- commission_per_contract:   your broker's commission per option contract ($0 at many brokers)

Until you save something, the defaults from config.py are used.
"""
from __future__ import annotations

import math
from dataclasses import replace

from sqlalchemy import insert, select, update

from core.config import DEFAULT_CONFIG, ScannerConfig
from core.db import get_engine, strategy

FIELDS = (
    "income_weight", "profit_capture_target_pct", "buyback_budget_pct", "monthly_goal",
    "delta_min", "delta_max", "min_dte", "max_dte", "event_buyback_pct", "commission_per_contract",
)
INT_FIELDS = ("min_dte", "max_dte")


def default_strategy() -> dict:
    return {
        "income_weight":             DEFAULT_CONFIG.income_weight,
        "profit_capture_target_pct": DEFAULT_CONFIG.profit_capture_target_pct,
        "buyback_budget_pct":        DEFAULT_CONFIG.buyback_budget_pct,
        "monthly_goal":              0.0,
        "delta_min":                 DEFAULT_CONFIG.delta_min,
        "delta_max":                 DEFAULT_CONFIG.delta_max,
        "min_dte":                   DEFAULT_CONFIG.min_dte,
        "max_dte":                   DEFAULT_CONFIG.max_dte,
        "event_buyback_pct":         DEFAULT_CONFIG.event_buyback_pct,
        "commission_per_contract":   DEFAULT_CONFIG.commission_per_contract,
    }


def _clean(values: dict) -> dict:
    return {k: (int(round(v)) if k in INT_FIELDS else float(v)) for k, v in values.items()}


def load_strategy() -> dict:
    """Saved strategy; anything not saved yet (or added after you saved) uses the default."""
    with get_engine().connect() as conn:
        row = conn.execute(select(strategy).where(strategy.c.id == 1)).mappings().first()
    out = default_strategy()
    if row is not None:
        out.update({k: row[k] for k in FIELDS if row[k] is not None})
    return _clean(out)


def save_strategy(values: dict) -> dict:
    """Save the strategy; fields left out keep their saved (or default) value. Returns what's stored."""
    row = _clean({**load_strategy(), **{k: v for k, v in values.items() if k in FIELDS and v is not None}})
    with get_engine().begin() as conn:
        if conn.execute(update(strategy).where(strategy.c.id == 1).values(**row)).rowcount == 0:
            conn.execute(insert(strategy).values(id=1, **row))
    return row


def effective_config(base: ScannerConfig = DEFAULT_CONFIG) -> ScannerConfig:
    """The scanner config with your saved strategy applied on top."""
    s = load_strategy()
    return replace(
        base,
        income_weight=s["income_weight"],
        profit_capture_target_pct=s["profit_capture_target_pct"],
        buyback_budget_pct=s["buyback_budget_pct"],
        delta_min=s["delta_min"],
        delta_max=s["delta_max"],
        min_dte=s["min_dte"],
        max_dte=s["max_dte"],
        event_buyback_pct=s["event_buyback_pct"],
    )


def split_contracts(total_contracts: int, income_weight: float) -> tuple[int, int]:
    """
    Split one stock's contracts into (income, balanced).

    income = total x income_weight, rounded to the nearest whole contract;
    an exact half always rounds up, so ties go to Income
    (e.g. 5 contracts at 50% -> 3 income, 2 balanced).
    """
    total = max(int(total_contracts), 0)
    income = math.floor(total * income_weight + 0.5 + 1e-9)
    income = min(max(income, 0), total)
    return income, total - income


def allocation_targets(total_contracts: int, open_income: int, open_balanced: int, income_weight: float) -> dict:
    """
    How many Income and Balanced contracts are still needed on one stock to
    reach the split, given what's already open.

    Never plans more contracts than the shares can cover. If the split was
    changed while calls are open, one side can already be over its target;
    the other side then only gets what is actually free.
    """
    total = max(int(total_contracts), 0)
    target_income, target_balanced = split_contracts(total, income_weight)
    free            = max(total - open_income - open_balanced, 0)
    needed_income   = min(max(target_income - open_income, 0), free)
    needed_balanced = min(max(target_balanced - open_balanced, 0), free - needed_income)
    return {
        "total_contracts":  total,
        "target_income":    target_income,
        "target_balanced":  target_balanced,
        "open_income":      open_income,
        "open_balanced":    open_balanced,
        "needed_income":    needed_income,
        "needed_balanced":  needed_balanced,
        "available":        needed_income + needed_balanced,
    }
