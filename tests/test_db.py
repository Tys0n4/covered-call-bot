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


def _statements_on_start(monkeypatch):
    """SQL run while the engine starts up (a server restart)."""
    from sqlalchemy import event
    seen = []
    real = db.create_engine

    def counting(*a, **k):
        engine = real(*a, **k)
        event.listen(engine, "before_cursor_execute", lambda *x, **y: seen.append(x[2]))
        return engine
    monkeypatch.setattr(db, "create_engine", counting)
    db._engine.dispose()
    monkeypatch.setattr(db, "_engine", None)
    db.get_engine()
    return seen


def test_a_restart_only_checks_the_schema_fingerprint(monkeypatch):
    db.get_engine()                                  # first start: sets everything up
    seen = _statements_on_start(monkeypatch)
    assert len(seen) == 1 and "schema_info" in seen[0]


def test_a_changed_schema_is_set_up_again(monkeypatch):
    from sqlalchemy import text, update
    engine = db.get_engine()
    with engine.begin() as conn:
        conn.execute(text("DROP TABLE daily_closes"))
        conn.execute(update(db.schema_info).values(fingerprint="from an older version"))
    _statements_on_start(monkeypatch)
    assert "daily_closes" in inspect(db.get_engine()).get_table_names()
    with db.get_engine().connect() as conn:
        assert conn.execute(db.schema_info.select()).mappings().one()["fingerprint"] == db.schema_fingerprint()


def test_startup_warm_up_connects():
    from api.main import _warm_up
    _warm_up()
    assert db._engine is not None
