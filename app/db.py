# db.py
"""
Database connection for holdings and covered call positions.

- Live (Railway): set the DATABASE_URL environment variable to your Postgres
  connection string (e.g. from Neon's free plan).
- Local: leave DATABASE_URL unset and a SQLite file is used instead
  (app/data/covcall.db). The first time it's created it is filled from
  data/portfolio.csv and data/open_positions.json so nothing is lost.
"""
from __future__ import annotations

import csv
import json
import os
import threading
from pathlib import Path

from sqlalchemy import (
    Column, Float, Integer, MetaData, String, Table, create_engine, func, insert, select,
)
from sqlalchemy.engine import Engine

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
SQLITE_PATH = DATA_DIR / "covcall.db"

# Files the local database is seeded from the first time it's created
SEED_PORTFOLIO = DATA_DIR / "portfolio.csv"
SEED_POSITIONS = DATA_DIR / "open_positions.json"

metadata = MetaData()

holdings = Table(
    "holdings", metadata,
    Column("ticker",   String(12), primary_key=True),
    Column("shares",   Integer, nullable=False),
    Column("avg_cost", Float,   nullable=False),
)

positions = Table(
    "positions", metadata,
    Column("id",              Integer, primary_key=True, autoincrement=True),
    Column("ticker",          String(12), nullable=False, index=True),
    Column("expiry",          String(10), nullable=False),
    Column("strike",          Float,   nullable=False),
    Column("contracts",       Integer, nullable=False),
    Column("entry_price",     Float,   nullable=False),
    Column("premium_total",   Float,   nullable=False),
    Column("premium_source",  String(16), nullable=False, default="NONE"),
    Column("quote_quality",   String(16), nullable=False, default="BAD"),
    Column("allocation_type", String(16), nullable=False),
    Column("status",          String(10), nullable=False, default="OPEN", index=True),
    Column("opened_at",       String(10), nullable=False),
    Column("closed_at",       String(10), nullable=True),
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
                if is_sqlite:
                    DATA_DIR.mkdir(parents=True, exist_ok=True)
                engine = create_engine(
                    url,
                    # Free Postgres plans suspend when idle; check connections before use
                    pool_pre_ping=True,
                    pool_recycle=300,
                    connect_args={"check_same_thread": False} if is_sqlite else {},
                )
                metadata.create_all(engine)
                if is_sqlite:
                    _seed_if_empty(engine)
                _engine = engine
    return _engine


def _seed_if_empty(engine: Engine) -> None:
    """Fill a brand-new local database from the old CSV/JSON files."""
    with engine.begin() as conn:
        has_data = (
            conn.execute(select(func.count()).select_from(holdings)).scalar()
            or conn.execute(select(func.count()).select_from(positions)).scalar()
        )
        if has_data:
            return
        holding_rows = read_seed_holdings()
        if holding_rows:
            conn.execute(insert(holdings), holding_rows)
        position_rows = read_seed_positions()
        if position_rows:
            conn.execute(insert(positions), position_rows)


def read_seed_holdings(path: Path = SEED_PORTFOLIO) -> list[dict]:
    if not path.exists():
        return []
    with open(path, newline="") as f:
        return [
            {"ticker": r["ticker"].strip().upper(), "shares": int(float(r["shares"])), "avg_cost": float(r["avg_cost"])}
            for r in csv.DictReader(f) if r.get("ticker")
        ]


def read_seed_positions(path: Path = SEED_POSITIONS) -> list[dict]:
    if not path.exists():
        return []
    try:
        raw = json.loads(path.read_text() or "[]")
    except json.JSONDecodeError:
        return []
    cols = {c.name for c in positions.columns}
    rows = []
    for p in raw:
        row = {k: v for k, v in p.items() if k in cols}
        row.setdefault("premium_source", "NONE")
        row.setdefault("quote_quality", "BAD")
        row.setdefault("status", "OPEN")
        rows.append(row)
    return rows
