# strategy.py
"""
Each account's strategy settings (edited on the Strategy page), stored in the
database: one row per account, id = the account's users.id.

- income_weight:             no longer used (every free contract goes on one call); kept for older rows
- profit_capture_target_pct: say "Buy back now" once this % of the premium is kept
- buyback_budget_pct:        no longer used; kept for older rows
- monthly_goal:              premium goal per month in dollars (0 = off)
- delta_min / delta_max:     sell calls with this chance of being called (0.20–0.30)
- min_dte / max_dte:         expiries this many days out (14–30)
- event_buyback_pct:         buy back at this % kept when earnings or a Fed meeting comes before expiry
- commission_per_contract:   your broker's commission per option contract ($0 at many brokers)

Until you save something, the defaults from config.py are used.
"""
from __future__ import annotations

import threading
import time
from dataclasses import replace

from sqlalchemy import insert, select, update

from core.config import DEFAULT_CONFIG, ScannerConfig
from core.db import get_engine, strategy

FIELDS = (
    "income_weight", "profit_capture_target_pct", "buyback_budget_pct", "monthly_goal",
    "delta_min", "delta_max", "min_dte", "max_dte", "event_buyback_pct", "commission_per_contract",
    "tax_account",
)
INT_FIELDS = ("min_dte", "max_dte")
TEXT_FIELDS = ("tax_account",)

# Most requests read the strategy (a scan several times) and it only changes through
# save_strategy(), so each account's is kept in memory. The time limit covers a
# change made by another server process.
STRATEGY_TTL = 60
_kept: dict[int, dict] = {}       # user_id -> {"engine", "at", "value"}
_kept_lock = threading.Lock()


def _keep(engine, user_id: int, value: dict) -> None:
    with _kept_lock:
        _kept[user_id] = {"engine": engine, "at": time.monotonic(), "value": dict(value)}


def forget(user_id: int) -> None:
    """Read the account's strategy from the database next time (it changed outside save_strategy)."""
    with _kept_lock:
        _kept.pop(user_id, None)


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
        "tax_account":               "taxable",
    }


def _clean(values: dict) -> dict:
    return {k: (str(v) if k in TEXT_FIELDS else int(round(v)) if k in INT_FIELDS else float(v)) for k, v in values.items()}


def load_strategy(user_id: int) -> dict:
    """The account's saved strategy; anything not saved yet (or added after it saved) uses the default."""
    engine = get_engine()
    with _kept_lock:
        kept = _kept.get(user_id)
        if kept and kept["engine"] is engine and time.monotonic() - kept["at"] < STRATEGY_TTL:
            return dict(kept["value"])
    with engine.connect() as conn:
        row = conn.execute(select(strategy).where(strategy.c.id == user_id)).mappings().first()
    out = default_strategy()
    if row is not None:
        out.update({k: row[k] for k in FIELDS if row[k] is not None})
    value = _clean(out)
    _keep(engine, user_id, value)
    return value


def save_strategy(user_id: int, values: dict) -> dict:
    """Save the account's strategy; fields left out keep their saved (or default) value. Returns what's stored."""
    row = _clean({**load_strategy(user_id), **{k: v for k, v in values.items() if k in FIELDS and v is not None}})
    engine = get_engine()
    with engine.begin() as conn:
        if conn.execute(update(strategy).where(strategy.c.id == user_id).values(**row)).rowcount == 0:
            conn.execute(insert(strategy).values(id=user_id, **row))
    _keep(engine, user_id, row)
    return row


def effective_config(user_id: int, base: ScannerConfig = DEFAULT_CONFIG) -> ScannerConfig:
    """The scanner config with the account's saved strategy (and broker commission) applied on top."""
    s = load_strategy(user_id)
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
        commission_per_contract=s["commission_per_contract"],
    )
