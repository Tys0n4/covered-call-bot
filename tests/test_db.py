# tests/test_db.py — upgrading a database created by an older version
import sqlite3

from sqlalchemy import inspect

from core import db


def test_old_positions_table_gets_new_columns(tmp_path, monkeypatch):
    path = tmp_path / "old.db"
    con = sqlite3.connect(path)
    con.execute("""CREATE TABLE positions (id INTEGER PRIMARY KEY, ticker VARCHAR(12) NOT NULL,
        expiry VARCHAR(10) NOT NULL, strike FLOAT NOT NULL, contracts INTEGER NOT NULL,
        entry_price FLOAT NOT NULL, premium_total FLOAT NOT NULL, premium_source VARCHAR(16) NOT NULL,
        quote_quality VARCHAR(16) NOT NULL, allocation_type VARCHAR(16) NOT NULL,
        status VARCHAR(10) NOT NULL, opened_at VARCHAR(10) NOT NULL, closed_at VARCHAR(10))""")
    con.execute("""INSERT INTO positions VALUES (1,'NVDA','2026-01-16',120,1,2,200,'MID','LIVE','Income',
        'CLOSED','2025-12-01','2025-12-20')""")
    con.commit()
    con.close()
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{path}")
    monkeypatch.setattr(db, "_engine", None)

    engine = db.get_engine()
    cols = {c["name"] for c in inspect(engine).get_columns("positions")}
    assert {"close_cost", "open_fees", "close_fees", "cost_basis", "rolled_from", "assignment_reviewed"} <= cols
    with engine.connect() as conn:
        row = conn.execute(db.positions.select()).mappings().one()
    assert row["premium_total"] == 200 and row["open_fees"] is None
