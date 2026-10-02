# strategy.py
"""
Your strategy settings (edited on the Strategy page), stored in the database.

- income_weight:             share of each stock's contracts sold as Income picks
- profit_capture_target_pct: say "Buy back now" once this % of the premium is kept
- buyback_budget_pct:        part of each premium set aside for buying calls back
- monthly_goal:              premium goal per month in dollars (0 = off)

Until you save something, the defaults from config.py are used.
"""
from __future__ import annotations

import math
from dataclasses import replace

from sqlalchemy import insert, select, update

from config import DEFAULT_CONFIG, ScannerConfig
from db import get_engine, strategy

FIELDS = ("income_weight", "profit_capture_target_pct", "buyback_budget_pct", "monthly_goal")


def default_strategy() -> dict:
    return {
        "income_weight":             DEFAULT_CONFIG.income_weight,
        "profit_capture_target_pct": DEFAULT_CONFIG.profit_capture_target_pct,
        "buyback_budget_pct":        DEFAULT_CONFIG.buyback_budget_pct,
        "monthly_goal":              0.0,
    }


def load_strategy() -> dict:
    """Saved strategy, or the defaults if nothing has been saved yet."""
    with get_engine().connect() as conn:
        row = conn.execute(select(strategy).where(strategy.c.id == 1)).mappings().first()
    if row is None:
        return default_strategy()
    return {k: float(row[k]) for k in FIELDS}


def save_strategy(values: dict) -> dict:
    """Save the strategy (all four fields) and return what was stored."""
    row = {k: float(values[k]) for k in FIELDS}
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
