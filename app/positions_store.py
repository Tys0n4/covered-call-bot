# positions_store.py
"""
Stores your covered call positions (open and closed) in the database
(see db.py). This is the source of truth for what positions are open.
"""

from __future__ import annotations
from sqlalchemy import and_, insert, select, update

from clock import local_today
from db import get_engine, positions
from market_hours import has_expired, market_today
from models import PlannedCall


def expire_finished_positions() -> int:
    """
    Mark OPEN calls whose expiry has passed (4pm New York on expiry day) as
    EXPIRED, closed on their expiry date with nothing paid to close.
    Returns how many were updated.
    """
    today = market_today()
    past = positions.c.expiry < today
    if has_expired(today):            # after today's close, today's expiries are done too
        past = positions.c.expiry <= today
    with get_engine().begin() as conn:
        result = conn.execute(
            update(positions)
            .where(and_(positions.c.status == "OPEN", past))
            .values(status="EXPIRED", closed_at=positions.c.expiry, close_cost=0.0)
        )
    return result.rowcount


def _rows(query) -> list[dict]:
    with get_engine().connect() as conn:
        return [dict(r) for r in conn.execute(query).mappings().all()]


def load_open_positions() -> list[dict]:
    """Return all positions with status OPEN (expired ones are closed out first)."""
    expire_finished_positions()
    rows = _rows(select(positions).where(positions.c.status == "OPEN").order_by(positions.c.id))
    for p in rows:
        p.pop("closed_at", None)
    return rows


def save_positions(planned: list[PlannedCall]) -> None:
    """Add new planned positions as OPEN, stamped with today's date."""
    if not planned:
        return
    today = local_today()
    records = [
        {
            "ticker":           p.ticker,
            "expiry":           p.expiry,
            "strike":           p.strike,
            "contracts":        p.contracts,
            "entry_price":      p.entry_price,
            "premium_total":    p.premium_total,
            "premium_source":   p.premium_source,
            "quote_quality":    p.quote_quality,
            "allocation_type":  p.allocation_type,
            "status":           "OPEN",
            "opened_at":        today,
            "closed_at":        None,
        }
        for p in planned
    ]
    with get_engine().begin() as conn:
        conn.execute(insert(positions), records)
    print(f"  Saved {len(planned)} position(s)")


def close_position(position_id: int, close_cost: float | None = None) -> bool:
    """
    Mark an OPEN position as CLOSED (bought back) by id.
    close_cost = total dollars paid to buy it back, if you entered it.
    Returns False if there's no open position with that id.
    """
    with get_engine().begin() as conn:
        result = conn.execute(
            update(positions)
            .where(and_(positions.c.id == position_id, positions.c.status == "OPEN"))
            .values(status="CLOSED", closed_at=local_today(),
                    close_cost=None if close_cost is None else round(float(close_cost), 2))
        )
    return result.rowcount > 0


def list_all_positions() -> list[dict]:
    """Return all positions including closed and expired ones."""
    expire_finished_positions()
    return _rows(select(positions).order_by(positions.c.id))
