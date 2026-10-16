# db.py
"""
Database connection for accounts, holdings and covered call positions.

- Live (Railway): set the DATABASE_URL environment variable to your Postgres
  connection string (e.g. from Neon's free plan).
- Local: leave DATABASE_URL unset and a SQLite file is used instead
  (backend/covcall.db, created empty on first run).

Every holding, call, strategy and alert setting belongs to one account
(users.id). A database from before accounts existed is upgraded on start: its
data is kept as account 0 ("unclaimed") until someone signs up with the old
app password (api/auth.py), and then it's theirs.
"""
from __future__ import annotations

import hashlib
import os
import threading
from pathlib import Path

from sqlalchemy import (
    Column, Float, Integer, MetaData, String, Table, create_engine, delete, insert, inspect, select, text,
)
from sqlalchemy.engine import Engine

SQLITE_PATH = Path(__file__).resolve().parent.parent / "covcall.db"   # backend/covcall.db (local only)

metadata = MetaData()

# Accounts: sign up with an email and password (api/auth.py)
users = Table(
    "users", metadata,
    Column("id",            Integer, primary_key=True, autoincrement=True),
    Column("email",         String(254), nullable=False, unique=True),   # stored lower case
    Column("password_hash", String(200), nullable=False),
    Column("created_at",    String(25), nullable=False),
    Column("token_version", Integer, nullable=True),       # raised to log out every device (NULL = 0)
    Column("recovery_hash", String(200), nullable=True),   # scrypt hash of the recovery code (shown once)
)

# Wrong passwords and sign-ups, one row each, so login limits survive the server
# sleeping (api/auth.py). Rows older than an hour are deleted as new ones arrive.
auth_limits = Table(
    "auth_limits", metadata,
    Column("id",  Integer, primary_key=True, autoincrement=True),
    Column("key", String(300), nullable=False, index=True),   # "login:<email>", "ip:<address>", "signup", ...
    Column("at",  Float, nullable=False),                     # unix seconds
)

UNCLAIMED = 0   # owner of data from before accounts existed, until it's claimed

holdings = Table(
    "holdings", metadata,
    Column("user_id",  Integer, primary_key=True, autoincrement=False),
    Column("ticker",   String(12), primary_key=True),
    Column("shares",   Integer, nullable=False),
    Column("avg_cost", Float,   nullable=False),
)

positions = Table(
    "positions", metadata,
    Column("id",              Integer, primary_key=True, autoincrement=True),
    Column("user_id",         Integer, nullable=True, index=True),   # added later; every row has one after the upgrade
    Column("ticker",          String(12), nullable=False, index=True),
    Column("expiry",          String(10), nullable=False),
    Column("strike",          Float,   nullable=False),
    Column("contracts",       Integer, nullable=False),
    Column("entry_price",     Float,   nullable=False),
    Column("premium_total",   Float,   nullable=False),
    Column("premium_source",  String(16), nullable=False, default="NONE"),
    Column("quote_quality",   String(16), nullable=False, default="BAD"),
    Column("allocation_type", String(16), nullable=False),
    Column("status",          String(10), nullable=False, default="OPEN", index=True),  # OPEN, CLOSED, EXPIRED, ASSIGNED
    Column("opened_at",       String(10), nullable=False),
    Column("closed_at",       String(10), nullable=True),
    Column("close_cost",      Float,   nullable=True),   # what you paid to buy it back ($ total)
    Column("open_fees",       Float,   nullable=True),   # commissions/fees when selling ($ total)
    Column("close_fees",      Float,   nullable=True),   # commissions/fees when buying back ($ total)
    Column("cost_basis",      Float,   nullable=True),   # your avg cost per share when the call was sold
    Column("rolled_from",     Integer, nullable=True),   # id of the call this one replaced (a roll)
    Column("assignment_reviewed", Integer, nullable=True),  # 1 = you confirmed whether it was assigned
    Column("buyback_alerted_at",  String(25), nullable=True),  # when a "buy back now" alert was sent
    Column("early_alerted_at",    String(25), nullable=True),  # when a "may be exercised early" alert was sent
    Column("strike_alerted_at",   String(25), nullable=True),  # when a "stock above your strike" alert was sent
)


# Each account's strategy (id = the account's users.id), edited on the Strategy page
strategy = Table(
    "strategy", metadata,
    Column("id",                        Integer, primary_key=True),
    Column("income_weight",             Float, nullable=False),
    Column("profit_capture_target_pct", Float, nullable=False),
    Column("buyback_budget_pct",        Float, nullable=False),
    Column("monthly_goal",              Float, nullable=False, default=0),
    # Added later (empty = use the default from config.py)
    Column("delta_min",                 Float, nullable=True),
    Column("delta_max",                 Float, nullable=True),
    Column("min_dte",                   Float, nullable=True),
    Column("max_dte",                   Float, nullable=True),
    Column("event_buyback_pct",         Float, nullable=True),
    Column("commission_per_contract",   Float, nullable=True),
)

# Each account's Discord alerts (id = the account's users.id), on the Strategy page
alert_settings = Table(
    "alert_settings", metadata,
    Column("id",              Integer, primary_key=True),
    Column("discord_webhook", String(300), nullable=True),
    Column("enabled",         Integer, nullable=False, default=0),
    Column("last_check_at",   String(25), nullable=True),   # last time the scheduled check ran
    Column("last_error",      String(300), nullable=True),  # why the last message couldn't be sent (None: it was)
    # Alerts besides "buy back now" (empty = on)
    Column("notify_early",    Integer, nullable=True),      # a call may be exercised early for the dividend
    Column("notify_strike",   Integer, nullable=True),      # a stock went above your strike
)

# Last earnings / ex-dividend dates Yahoo gave per stock, used when Yahoo doesn't answer
known_events = Table(
    "known_events", metadata,
    Column("ticker",           String(12), primary_key=True),
    Column("earnings_date",    String(10), nullable=True),
    Column("ex_dividend_date", String(10), nullable=True),
    Column("checked_at",       String(25), nullable=False),   # when Yahoo last answered
)

# A stock's close on a past day (the day shares were called away, an expiry
# day), saved once Yahoo gives it: a finished day's close never changes
daily_closes = Table(
    "daily_closes", metadata,
    Column("ticker", String(12), primary_key=True),
    Column("day",    String(10), primary_key=True),
    Column("close",  Float, nullable=False),
)

# Values the app generates once and keeps, e.g. the key that signs login tokens
app_settings = Table(
    "app_settings", metadata,
    Column("key",   String(40), primary_key=True),
    Column("value", String(200), nullable=False),
)

# The schema_fingerprint() the database was last set up for (a single row, id = 1)
schema_info = Table(
    "schema_info", metadata,
    Column("id",          Integer, primary_key=True),
    Column("fingerprint", String(64), nullable=False),
)


def database_url() -> str:
    """DATABASE_URL if set (normalized for SQLAlchemy + psycopg), else the local SQLite file."""
    url = os.environ.get("DATABASE_URL", "").strip()
    if not url:
        return f"sqlite:///{SQLITE_PATH}"
    # Providers hand out postgres:// or postgresql:// — tell SQLAlchemy to use psycopg 3
    if url.startswith("postgres://"):
        url = "postgresql+psycopg://" + url[len("postgres://"):]
    elif url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


_engine: Engine | None = None
_lock = threading.Lock()


def get_engine() -> Engine:
    """Create the engine and tables on first use."""
    global _engine
    if _engine is None:
        with _lock:
            if _engine is None:
                url = database_url()
                is_sqlite = url.startswith("sqlite")
                engine = create_engine(
                    url,
                    # Free Postgres plans suspend when idle; check connections before use
                    pool_pre_ping=True,
                    pool_recycle=300,
                    connect_args={"check_same_thread": False} if is_sqlite else {},
                )
                # Checking every table and column takes a dozen catalog queries, each a round
                # trip to the database, on every server start (and the server sleeps when idle).
                # So it only runs when the tables defined here changed since the last time.
                if not _schema_is_current(engine):
                    _upgrade_holdings_for_accounts(engine)
                    metadata.create_all(engine)
                    _add_missing_columns(engine)
                    _keep_unowned_data_unclaimed(engine)
                    _mark_schema_current(engine)
                _engine = engine
    return _engine


def schema_fingerprint() -> str:
    """A hash of every table and column defined in this file: it changes whenever they do."""
    parts = sorted(f"{t.name}.{c.name}:{c.type}" for t in metadata.sorted_tables for c in t.columns)
    return hashlib.sha256("\n".join(parts).encode()).hexdigest()


def _schema_is_current(engine: Engine) -> bool:
    try:
        with engine.connect() as conn:
            stored = conn.execute(select(schema_info.c.fingerprint).where(schema_info.c.id == 1)).scalar()
    except Exception:   # no schema_info table: a new database, or one from before it existed
        return False
    return stored == schema_fingerprint()


def _mark_schema_current(engine: Engine) -> None:
    with engine.begin() as conn:
        conn.execute(delete(schema_info))
        conn.execute(insert(schema_info).values(id=1, fingerprint=schema_fingerprint()))


def _add_missing_columns(engine: Engine) -> None:
    """
    create_all() makes missing tables but never changes existing ones, so add
    any column introduced after a table was first created (safe to re-run).
    """
    added_later = {"users": [
        users.c.token_version, users.c.recovery_hash,
    ], "strategy": [
        strategy.c.delta_min, strategy.c.delta_max, strategy.c.min_dte, strategy.c.max_dte,
        strategy.c.event_buyback_pct, strategy.c.commission_per_contract,
    ], "positions": [
        positions.c.close_cost, positions.c.open_fees, positions.c.close_fees,
        positions.c.cost_basis, positions.c.rolled_from, positions.c.assignment_reviewed,
        positions.c.buyback_alerted_at, positions.c.early_alerted_at, positions.c.strike_alerted_at,
        positions.c.user_id,
    ], "alert_settings": [
        alert_settings.c.last_error, alert_settings.c.notify_early, alert_settings.c.notify_strike,
    ]}
    insp = inspect(engine)
    for table_name, cols in added_later.items():
        existing = {c["name"] for c in insp.get_columns(table_name)}
        for col in cols:
            if col.name not in existing:
                col_type = col.type.compile(dialect=engine.dialect)
                with engine.begin() as conn:
                    conn.execute(text(f'ALTER TABLE {table_name} ADD COLUMN {col.name} {col_type}'))


def _upgrade_holdings_for_accounts(engine: Engine) -> None:
    """
    Holdings from before accounts were keyed by ticker alone, so two people
    couldn't both hold AAPL. Rebuild the table keyed by account and ticker,
    keeping its rows as unclaimed (account 0). Read, drop, create and refill in
    one transaction (renaming would clash with Postgres's primary key name).
    """
    insp = inspect(engine)
    if "holdings" not in insp.get_table_names():
        return
    if "user_id" in {c["name"] for c in insp.get_columns("holdings")}:
        return
    with engine.begin() as conn:
        rows = [dict(r) for r in conn.execute(text("SELECT ticker, shares, avg_cost FROM holdings")).mappings()]
        conn.execute(text("DROP TABLE holdings"))
        holdings.create(conn)
        if rows:
            conn.execute(insert(holdings), [{"user_id": UNCLAIMED, **r} for r in rows])


def _keep_unowned_data_unclaimed(engine: Engine) -> None:
    """
    Calls, the strategy and alert settings from before accounts (no account,
    or the old single row id = 1 while there are no accounts yet) become
    account 0's, so the first person to sign up doesn't get them by accident.
    """
    with engine.begin() as conn:
        conn.execute(text("UPDATE positions SET user_id = :u WHERE user_id IS NULL"), {"u": UNCLAIMED})
        if conn.execute(select(users.c.id).limit(1)).first() is None:
            for table in (strategy, alert_settings):
                if conn.execute(select(table.c.id).where(table.c.id == UNCLAIMED)).first() is None:
                    conn.execute(text(f"UPDATE {table.name} SET id = :u WHERE id = 1"), {"u": UNCLAIMED})
