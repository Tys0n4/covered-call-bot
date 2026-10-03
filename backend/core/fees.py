# fees.py
"""
Your usual commission per option contract, learned from the fees you've
recorded when selling calls (median of your last 20), so estimates match your
broker without another setting. Until you've recorded any, a typical $0.65.
"""
from __future__ import annotations

from statistics import median

from sqlalchemy import select

from core.config import DEFAULT_CONFIG
from core.db import get_engine, positions


def typical_fee_per_contract() -> float:
    with get_engine().connect() as conn:
        rows = conn.execute(
            select(positions.c.open_fees, positions.c.contracts)
            .where(positions.c.open_fees > 0, positions.c.contracts > 0)
            .order_by(positions.c.id.desc()).limit(20)
        ).all()
    if not rows:
        return DEFAULT_CONFIG.default_fee_per_contract
    return round(min(median(float(f) / int(c) for f, c in rows), 10.0), 2)
