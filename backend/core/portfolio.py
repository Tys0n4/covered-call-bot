# portfolio.py
"""
Each account's stock holdings (ticker, shares, average cost), stored in the
database (see db.py). The app reads and edits them through the /portfolio API.
"""
import re

from sqlalchemy import delete, select, update, insert

from core.db import get_engine, holdings
from core.models import PortfolioPosition

# 1–10 characters: letters, digits, dot or dash (e.g. AAPL, BRK.B, RDS-A)
TICKER_RE = re.compile(r"^[A-Z][A-Z0-9.\-]{0,9}$")


def normalize_ticker(ticker: str) -> str:
    """Uppercase and trim a ticker, raising ValueError if it isn't valid."""
    t = (ticker or "").strip().upper()
    if not TICKER_RE.match(t):
        raise ValueError(f"'{ticker}' is not a valid ticker symbol.")
    return t


def load_portfolio(user_id: int) -> list[PortfolioPosition]:
    """Return the account's holdings, by ticker."""
    with get_engine().connect() as conn:
        rows = conn.execute(select(holdings).where(holdings.c.user_id == user_id).order_by(holdings.c.ticker)).mappings().all()
    return [
        PortfolioPosition(ticker=r["ticker"], shares=int(r["shares"]), avg_cost=float(r["avg_cost"]))
        for r in rows
    ]


def _mine(user_id: int, ticker: str):
    return (holdings.c.user_id == user_id) & (holdings.c.ticker == ticker)


def upsert_holding(user_id: int, ticker: str, shares: int, avg_cost: float) -> PortfolioPosition:
    """Add a new holding, or update shares/avg cost if the account already holds the ticker."""
    t = normalize_ticker(ticker)
    values = {"shares": int(shares), "avg_cost": round(float(avg_cost), 2)}
    with get_engine().begin() as conn:
        updated = conn.execute(update(holdings).where(_mine(user_id, t)).values(**values)).rowcount
        if not updated:
            conn.execute(insert(holdings).values(user_id=user_id, ticker=t, **values))
    return PortfolioPosition(ticker=t, **values)


def delete_holding(user_id: int, ticker: str) -> bool:
    """Remove a holding. Returns False if the account doesn't hold the ticker."""
    t = normalize_ticker(ticker)
    with get_engine().begin() as conn:
        return conn.execute(delete(holdings).where(_mine(user_id, t))).rowcount > 0
