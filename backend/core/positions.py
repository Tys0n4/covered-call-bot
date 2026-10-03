# positions.py
"""
Stores your covered call positions (open and closed) in the database
(see db.py). This is the source of truth for what positions are open.
"""

from __future__ import annotations
from collections import defaultdict

from sqlalchemy import and_, delete, func, insert, or_, select, update
from sqlalchemy.engine import Connection

from core.clock import local_today
from core.db import get_engine, holdings, positions
from core.market_hours import has_expired, market_today
from core.models import PlannedCall
from core.strategy import allocation_targets


class PositionError(ValueError):
    """A change to a position that can't be made (the message says why)."""


class CoverageError(PositionError):
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


def _check_coverage(conn: Connection, planned: list[PlannedCall], income_weight: float | None) -> dict[str, float]:
    """
    Raise CoverageError unless every ticker's open + new contracts fit in its
    shares (100 per contract). With income_weight, each side (Income /
    Balanced) must also fit what the split still needs, which also stops the
    same scan from being saved twice.

    Returns each ticker's average cost per share (recorded on the new calls).
    """
    avg_costs: dict[str, float] = {}
    new_by_ticker: dict[str, dict[str, int]] = defaultdict(lambda: {"Income": 0, "Balanced": 0})
    for p in planned:
        new_by_ticker[p.ticker][p.allocation_type] = new_by_ticker[p.ticker].get(p.allocation_type, 0) + int(p.contracts)

    for ticker, new in new_by_ticker.items():
        # Lock the holding row (Postgres) so two saves can't both pass the check
        holding = conn.execute(
            select(holdings.c.shares, holdings.c.avg_cost).where(holdings.c.ticker == ticker).with_for_update()
        ).first()
        if holding is None:
            raise CoverageError(f"{ticker} is not in your portfolio. Add it on the Dashboard first.")
        shares = int(holding.shares)
        avg_costs[ticker] = float(holding.avg_cost)
        total = shares // 100

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
    return avg_costs


def _insert_positions(
    conn: Connection,
    planned: list[PlannedCall],
    opened: str,
    income_weight: float | None,
    rolled_from: int | None = None,
) -> list[int]:
    """Coverage check + insert inside the caller's transaction. Returns the new ids."""
    avg_costs = _check_coverage(conn, planned, income_weight)
    ids = []
    for p in planned:
        record = {
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
            "open_fees":        round(float(p.fees or 0), 2),
            "cost_basis":       avg_costs.get(p.ticker) or None,
            "rolled_from":      rolled_from,
        }
        ids.append(conn.execute(insert(positions).values(**record)).inserted_primary_key[0])
    return ids


def save_positions(
    planned: list[PlannedCall],
    *,
    opened_at: str | None = None,
    income_weight: float | None = None,
) -> list[int]:
    """
    Add new positions as OPEN, stamped with opened_at (default: today).
    Returns the new position ids.

    Refuses (CoverageError) anything your shares don't cover; pass
    income_weight to also hold each side to your split. The check and the
    insert happen in one transaction.
    """
    if not planned:
        return []
    expire_finished_positions()   # calls that have expired no longer use up shares
    with get_engine().begin() as conn:
        return _insert_positions(conn, planned, opened_at or local_today(), income_weight)


def _money(v: float | None) -> float | None:
    return None if v is None else round(float(v), 2)


def close_position(position_id: int, close_cost: float | None = None, close_fees: float | None = None) -> bool:
    """
    Mark an OPEN position as CLOSED (bought back) by id.
    close_cost = total dollars paid to buy it back, close_fees = commissions,
    if you entered them. Returns False if there's no open position with that id.
    """
    with get_engine().begin() as conn:
        result = conn.execute(
            update(positions)
            .where(and_(positions.c.id == position_id, positions.c.status == "OPEN"))
            .values(status="CLOSED", closed_at=local_today(),
                    close_cost=_money(close_cost), close_fees=_money(close_fees))
        )
    return result.rowcount > 0


def roll_position(
    position_id: int,
    new_call: PlannedCall,
    close_cost: float,
    close_fees: float = 0.0,
) -> int | None:
    """
    Roll a call: buy the open one back and sell new_call in its place, in one
    transaction. new_call keeps the old call's ticker and Income/Balanced type.
    Returns the new position's id, or None if there's no open position with
    that id. Raises PositionError / CoverageError if the new call can't be sold.
    """
    if has_expired(new_call.expiry):
        raise PositionError("The new expiry has already passed. Pick a later date.")
    expire_finished_positions()
    with get_engine().begin() as conn:
        old = conn.execute(
            select(positions).where(and_(positions.c.id == position_id, positions.c.status == "OPEN")).with_for_update()
        ).mappings().first()
        if old is None:
            return None
        new_call.ticker = old["ticker"]
        new_call.allocation_type = old["allocation_type"]
        today = local_today()
        conn.execute(
            update(positions).where(positions.c.id == position_id)
            .values(status="CLOSED", closed_at=today, close_cost=_money(close_cost), close_fees=_money(close_fees))
        )
        return _insert_positions(conn, [new_call], today, None, rolled_from=position_id)[0]


def assign_position(position_id: int, assigned_on: str | None = None) -> dict | None:
    """
    Record that a call was exercised: your shares were sold at the strike.

    Works on OPEN calls (early assignment) and EXPIRED ones (finished in the
    money). The premium is kept in full and the holding loses
    contracts x 100 shares. Returns the updated position, or None if there's
    no open/expired position with that id.
    """
    expire_finished_positions()
    with get_engine().begin() as conn:
        pos = conn.execute(
            select(positions)
            .where(and_(positions.c.id == position_id, positions.c.status.in_(("OPEN", "EXPIRED"))))
            .with_for_update()
        ).mappings().first()
        if pos is None:
            return None
        ticker, contracts = pos["ticker"], int(pos["contracts"])
        holding = conn.execute(
            select(holdings.c.shares, holdings.c.avg_cost).where(holdings.c.ticker == ticker).with_for_update()
        ).first()
        if holding is None:
            raise PositionError(f"{ticker} is no longer in your portfolio, so there are no shares to remove. Add it back first.")
        shares, needed = int(holding.shares), contracts * 100
        if shares < needed:
            raise PositionError(
                f"Your portfolio shows {shares:,} {ticker} shares, but this call covers {needed:,}. "
                "Correct your share count on the Dashboard first."
            )
        # Other open calls must still be covered by the shares that are left
        other_open = conn.execute(
            select(func.coalesce(func.sum(positions.c.contracts), 0))
            .where(and_(positions.c.ticker == ticker, positions.c.status == "OPEN", positions.c.id != position_id))
        ).scalar()
        if (shares - needed) // 100 < int(other_open):
            raise PositionError(
                f"After giving up {needed:,} shares you'd have {shares - needed:,} {ticker} shares left, "
                f"not enough for your other {int(other_open)} open call contract(s). Close or roll those first."
            )

        conn.execute(update(holdings).where(holdings.c.ticker == ticker).values(shares=shares - needed))
        closed_on = assigned_on or (pos["expiry"] if pos["status"] == "EXPIRED" else local_today())
        conn.execute(
            update(positions).where(positions.c.id == position_id).values(
                status="ASSIGNED",
                closed_at=closed_on,
                close_cost=0.0,
                cost_basis=pos["cost_basis"] if pos["cost_basis"] is not None else float(holding.avg_cost),
                assignment_reviewed=1,
            )
        )
        return dict(conn.execute(select(positions).where(positions.c.id == position_id)).mappings().first())


def dismiss_assignment(position_id: int) -> bool:
    """You checked: this expired call was not assigned. Stop asking about it."""
    with get_engine().begin() as conn:
        result = conn.execute(
            update(positions)
            .where(and_(positions.c.id == position_id, positions.c.status == "EXPIRED"))
            .values(assignment_reviewed=1)
        )
    return result.rowcount > 0


def expired_unreviewed(since: str) -> list[dict]:
    """EXPIRED calls with expiry on/after `since` that you haven't reviewed for assignment."""
    expire_finished_positions()
    return _rows(
        select(positions)
        .where(and_(
            positions.c.status == "EXPIRED",
            positions.c.expiry >= since,
            or_(positions.c.assignment_reviewed.is_(None), positions.c.assignment_reviewed == 0),
        ))
        .order_by(positions.c.expiry, positions.c.id)
    )


EDITABLE = ("entry_price", "open_fees", "close_cost", "close_fees")


def edit_position(position_id: int, changes: dict) -> dict | None:
    """
    Fix what was recorded for a trade: the fill price (premium is recomputed),
    fees, and for bought-back calls the buyback cost. Returns the updated
    position, or None if there's no position with that id.
    """
    changes = {k: v for k, v in changes.items() if k in EDITABLE}
    with get_engine().begin() as conn:
        pos = conn.execute(select(positions).where(positions.c.id == position_id).with_for_update()).mappings().first()
        if pos is None:
            return None
        if ({"close_cost", "close_fees"} & changes.keys()) and pos["status"] != "CLOSED":
            raise PositionError("Only bought-back calls have a buyback cost and closing fees.")
        values = {k: _money(v) for k, v in changes.items()}
        if "entry_price" in changes:
            values["entry_price"] = round(float(changes["entry_price"]), 4)
            values["premium_total"] = round(float(changes["entry_price"]) * int(pos["contracts"]) * 100, 2)
        if values:
            conn.execute(update(positions).where(positions.c.id == position_id).values(**values))
        return dict(conn.execute(select(positions).where(positions.c.id == position_id)).mappings().first())


def undo_position(position_id: int) -> dict | None:
    """
    Undo how a call was finished:
      - bought back (CLOSED): it's open again; if it was rolled, the new call
        from the roll is removed (it must still be open)
      - ASSIGNED: the shares go back into your holding and the call returns
        to OPEN (or EXPIRED, if its expiry has passed)
    Expired calls are closed automatically, so there's nothing to undo.
    Returns what changed, or None if there's no position with that id.
    """
    with get_engine().begin() as conn:
        pos = conn.execute(select(positions).where(positions.c.id == position_id).with_for_update()).mappings().first()
        if pos is None:
            return None
        ticker, contracts = pos["ticker"], int(pos["contracts"])

        if pos["status"] == "OPEN":
            raise PositionError("This call is still open, so there's nothing to undo.")
        if pos["status"] == "EXPIRED":
            raise PositionError(
                "Expired calls are closed automatically. If your shares were called away, "
                "record that instead."
            )

        holding = conn.execute(
            select(holdings.c.shares, holdings.c.avg_cost).where(holdings.c.ticker == ticker).with_for_update()
        ).first()

        if pos["status"] == "ASSIGNED":
            returned = contracts * 100
            if holding is None:
                conn.execute(insert(holdings).values(ticker=ticker, shares=returned, avg_cost=float(pos["cost_basis"] or 0)))
            else:
                conn.execute(update(holdings).where(holdings.c.ticker == ticker).values(shares=int(holding.shares) + returned))
            if has_expired(pos["expiry"]):
                values = dict(status="EXPIRED", closed_at=pos["expiry"], close_cost=0.0, assignment_reviewed=1)
            else:
                values = dict(status="OPEN", closed_at=None, close_cost=None, close_fees=None, assignment_reviewed=None)
            conn.execute(update(positions).where(positions.c.id == position_id).values(**values))
            return {"undone": position_id, "status": values["status"], "removed": None, "shares_returned": returned}

        # CLOSED (bought back, possibly rolled)
        child = conn.execute(select(positions).where(positions.c.rolled_from == position_id)).mappings().first()
        if child is not None and child["status"] != "OPEN":
            raise PositionError(
                f"This call was rolled into the ${float(child['strike']):,.2f} call, which has since finished. "
                "Undo that one first."
            )
        if holding is None:
            raise CoverageError(f"{ticker} is no longer in your portfolio. Add it back before reopening this call.")
        other_open = conn.execute(
            select(func.coalesce(func.sum(positions.c.contracts), 0)).where(and_(
                positions.c.ticker == ticker, positions.c.status == "OPEN",
                positions.c.id != (child["id"] if child is not None else -1),
            ))
        ).scalar()
        total = int(holding.shares) // 100
        if int(other_open) + contracts > total:
            raise CoverageError(
                f"Reopening this call would need {contracts} more contract(s), but your {int(holding.shares):,} "
                f"{ticker} shares cover {total} and {int(other_open)} already have calls sold."
            )
        if child is not None:
            conn.execute(delete(positions).where(positions.c.id == child["id"]))
        conn.execute(
            update(positions).where(positions.c.id == position_id)
            .values(status="OPEN", closed_at=None, close_cost=None, close_fees=None)
        )
    status = "OPEN"
    if has_expired(pos["expiry"]):
        expire_finished_positions()       # it had already expired: close it out properly
        status = "EXPIRED"
    return {"undone": position_id, "status": status, "removed": child["id"] if child is not None else None,
            "shares_returned": 0}


def delete_position(position_id: int) -> bool:
    """
    Delete an OPEN call that was entered by mistake (wrong strike, expiry or
    contract count). Finished calls are part of your history and can't be
    deleted; undo how they finished instead. Returns False if there's no open
    call with that id.
    """
    with get_engine().begin() as conn:
        pos = conn.execute(select(positions).where(positions.c.id == position_id).with_for_update()).mappings().first()
        if pos is None or pos["status"] != "OPEN":
            return False
        # A call that replaced another (a roll) is undone from the original, so the old call reopens too
        if pos["rolled_from"] is not None:
            raise PositionError("This call came from a roll. Undo the roll from History instead, so the original call reopens.")
        conn.execute(delete(positions).where(positions.c.id == position_id))
    return True


def list_all_positions() -> list[dict]:
    """Return all positions including closed and expired ones."""
    expire_finished_positions()
    return _rows(select(positions).order_by(positions.c.id))
