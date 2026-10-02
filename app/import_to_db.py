# import_to_db.py
"""
One-time copy of data/portfolio.csv and data/open_positions.json into the
database named by DATABASE_URL (e.g. your Neon database).

Run from the project root:
    DATABASE_URL="postgresql://..." python app/import_to_db.py            (macOS/Linux)
    $env:DATABASE_URL="postgresql://..."; python app/import_to_db.py      (Windows PowerShell)

Safe to run more than once: holdings already in the database are left alone,
and positions are only copied if the database has none yet.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from sqlalchemy import func, insert, select

from db import database_url, get_engine, holdings, positions, read_seed_holdings, read_seed_positions


def main() -> None:
    url = database_url()
    where = "local SQLite file" if url.startswith("sqlite") else url.split("@")[-1].split("/")[0]
    print(f"Importing into: {where}")

    engine = get_engine()
    with engine.begin() as conn:
        existing = set(conn.execute(select(holdings.c.ticker)).scalars())
        new_holdings = [h for h in read_seed_holdings() if h["ticker"] not in existing]
        if new_holdings:
            conn.execute(insert(holdings), new_holdings)
        print(f"  Holdings: added {len(new_holdings)}, skipped {len(existing)} already there")

        count = conn.execute(select(func.count()).select_from(positions)).scalar()
        if count:
            print(f"  Positions: database already has {count}, nothing copied")
        else:
            rows = [{k: v for k, v in p.items() if k != "id"} for p in read_seed_positions()]
            if rows:
                conn.execute(insert(positions), rows)
            print(f"  Positions: copied {len(rows)}")
    print("Done.")


if __name__ == "__main__":
    main()
