# positions_store.py
"""
Stores your covered call positions (open and closed) in the database
(see db.py). This is the source of truth for what positions are open.
"""

from __future__ import annotations
from collections import defaultdict

from sqlalchemy import and_, func, insert, select, update
from sqlalchemy.engine import Connection

from clock import local_today
from db import get_engine, holdings, positions
from market_hours import has_expired, market_today
from models import PlannedCall
from strategy import allocation_targets


class CoverageError(ValueError):
    """Saving these calls would sell more contracts than your shares cover."""


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


def _contracts_word(n: int) -> str:
    return f"{n} contract{'' if n == 1 else 's'}"


def _check_coverage(conn: Connection, planned: list[PlannedCall], income_weight: float | None) -> None:
    """
    Raise CoverageError unless every ticker's open + new contracts fit in its
    shares (100 per contract). With income_weight, each side (Income /
    Balanced) must also fit what the split still needs, which also stops the
    same scan from being saved twice.
    """
    new_by_ticker: dict[str, dict[str, int]] = defaultdict(lambda: {"Income": 0, "Balanced": 0})
    for p in planned:
        new_by_ticker[p.ticker][p.allocation_type] = new_by_ticker[p.ticker].get(p.allocation_type, 0) + int(p.contracts)

    for ticker, new in new_by_ticker.items():
        # Lock the holding row (Postgres) so two saves can't both pass the check
        shares = conn.execute(
            select(holdings.c.shares).where(holdings.c.ticker == ticker).with_for_update()
        ).scalar()
        if shares is None:
            raise CoverageError(f"{ticker} is not in your portfolio. Add it on the Dashboard first.")
        total = int(shares) // 100

        open_by_type = {
            t: int(n) for t, n in conn.execute(
                select(positions.c.allocation_type, func.sum(positions.c.contracts))
                .where(and_(positions.c.ticker == ticker, positions.c.status == "OPEN"))
                .group_by(positions.c.allocation_type)
            ).all()
        }
        open_total = sum(open_by_type.values())
        new_total = sum(new.values())
        free = max(total - open_total, 0)
        if new_total > free:
            raise CoverageError(
                f"Your {shares:,} {ticker} shares cover {_contracts_word(total)} and {open_total} "
                f"already have calls sold, so only {free} more can be covered (not {new_total})."
            )

        if income_weight is not None:
            t = allocation_targets(total, open_by_type.get("Income", 0), open_by_type.get("Balanced", 0), income_weight)
            if new["Income"] > t["needed_income"] or new["Balanced"] > t["needed_balanced"]:
                raise CoverageError(
                    f"This trade no longer fits your {ticker} plan: it sells {new['Income']} income and "
                    f"{new['Balanced']} balanced, but only {t['needed_income']} and {t['needed_balanced']} are "
                    "still needed. It may already be saved; check Positions or scan again."
                )


def save_positions(
    planned: list[PlannedCall],
    *,
    opened_at: str | None = None,
    income_weight: float | None = None,
) -> None:
    """
    Add new positions as OPEN, stamped with opened_at (default: today).

    Refuses (CoverageError) anything your shares don't cover; pass
    income_weight to also hold each side to your split. The check and the
    insert happen in one transaction.
    """
    if not planned:
        return
    expire_finished_positions()   # calls that have expired no longer use up shares
    opened = opened_at or local_today()
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
            "opened_at":        opened,
            "closed_at":        None,
        }
        for p in planned
    ]
    with get_engine().begin() as conn:
        _check_coverage(conn, planned, income_weight)
        conn.execute(insert(positions), records)


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
