# positions_store.py
"""
Persists open covered call positions to/from a JSON file.
This is the source of truth for what positions are currently open.

File location: data/open_positions.json
"""

from __future__ import annotations
import json
from pathlib import Path
from datetime import datetime

from models import PlannedCall

BASE_DIR = Path(__file__).resolve().parent
POSITIONS_FILE = BASE_DIR / "data" / "open_positions.json"


def _load_raw() -> list[dict]:
    if not POSITIONS_FILE.exists():
        return []
    try:
        with open(POSITIONS_FILE, "r") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return []


def _save_raw(positions: list[dict]) -> None:
    POSITIONS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(POSITIONS_FILE, "w") as f:
        json.dump(positions, f, indent=2)


def load_open_positions() -> list[dict]:
    """Return all positions with status OPEN."""
    positions = [p for p in _load_raw() if p.get("status") == "OPEN"]
    for p in positions:
        p.pop("closed_at", None)
    return positions


def save_positions(planned: list[PlannedCall]) -> None:
    """
    Append new planned positions to the store.
    Assigns an id and opened_at timestamp to each.
    """
    existing = _load_raw()

    next_id = max((p.get("id", 0) for p in existing), default=0) + 1

    for i, p in enumerate(planned):
        record = {
            "id":               next_id + i,
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
            "opened_at":        datetime.today().strftime("%Y-%m-%d"),
            "closed_at":        None,
        }
        existing.append(record)

    _save_raw(existing)
    print(f"  Saved {len(planned)} position(s) to {POSITIONS_FILE}")


def close_position(position_id: int) -> bool:
    """Mark a position as CLOSED by id. Returns True if found."""
    positions = _load_raw()
    found = False

    for p in positions:
        if p.get("id") == position_id:
            p["status"] = "CLOSED"
            p["closed_at"] = datetime.today().strftime("%Y-%m-%d")
            found = True
            break

    if found:
        _save_raw(positions)

    return found


def list_all_positions() -> list[dict]:
    """Return all positions including closed ones."""
    return _load_raw()
