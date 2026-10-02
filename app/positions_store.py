# positions_store.py
"""
Stores your covered call positions (open and closed) in the database
(see db.py). This is the source of truth for what positions are open.
"""

from __future__ import annotations
from datetime import datetime

from sqlalchemy import insert, select, update

from db import get_engine, positions
from models import PlannedCall


def _rows(query) -> list[dict]:
    with get_engine().connect() as conn:
        return [dict(r) for r in conn.execute(query).mappings().all()]


def load_open_positions() -> list[dict]:
    """Return all positions with status OPEN."""
    rows = _rows(select(positions).where(positions.c.status == "OPEN").order_by(positions.c.id))
    for p in rows:
        p.pop("closed_at", None)
    return rows


def save_positions(planned: list[PlannedCall]) -> None:
    """Add new planned positions as OPEN, stamped with today's date."""
    if not planned:
        return
    today = datetime.today().strftime("%Y-%m-%d")
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


def close_position(position_id: int) -> bool:
    """Mark a position as CLOSED by id. Returns True if found."""
    with get_engine().begin() as conn:
        result = conn.execute(
            update(positions)
            .where(positions.c.id == position_id)
            .values(status="CLOSED", closed_at=datetime.today().strftime("%Y-%m-%d"))
        )
    return result.rowcount > 0


def list_all_positions() -> list[dict]:
    """Return all positions including closed ones."""
    return _rows(select(positions).order_by(positions.c.id))
