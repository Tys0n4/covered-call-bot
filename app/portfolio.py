# portfolio.py
"""
Your stock holdings (ticker, shares, average cost), stored in the database
(see db.py). The app reads and edits them through the /portfolio API.
"""
import re

from sqlalchemy import delete, select, update, insert

from db import get_engine, holdings
from models import PortfolioPosition

# 1–10 characters: letters, digits, dot or dash (e.g. AAPL, BRK.B, RDS-A)
TICKER_RE = re.compile(r"^[A-Z][A-Z0-9.\-]{0,9}$")


def normalize_ticker(ticker: str) -> str:
    """Uppercase and trim a ticker, raising ValueError if it isn't valid."""
    t = (ticker or "").strip().upper()
    if not TICKER_RE.match(t):
        raise ValueError(f"'{ticker}' is not a valid ticker symbol.")
    return t


def load_portfolio() -> list[PortfolioPosition]:
    """Return all holdings, in the order they were added."""
    with get_engine().connect() as conn:
        rows = conn.execute(select(holdings)).mappings().all()
    return [
        PortfolioPosition(ticker=r["ticker"], shares=int(r["shares"]), avg_cost=float(r["avg_cost"]))
        for r in rows
    ]


def upsert_holding(ticker: str, shares: int, avg_cost: float) -> PortfolioPosition:
    """Add a new holding, or update shares/avg cost if the ticker already exists."""
    t = normalize_ticker(ticker)
    values = {"shares": int(shares), "avg_cost": round(float(avg_cost), 2)}
    with get_engine().begin() as conn:
        updated = conn.execute(update(holdings).where(holdings.c.ticker == t).values(**values)).rowcount
        if not updated:
            conn.execute(insert(holdings).values(ticker=t, **values))
    return PortfolioPosition(ticker=t, **values)


def delete_holding(ticker: str) -> bool:
    """Remove a holding. Returns False if the ticker wasn't in the portfolio."""
    t = normalize_ticker(ticker)
    with get_engine().begin() as conn:
        return conn.execute(delete(holdings).where(holdings.c.ticker == t)).rowcount > 0
