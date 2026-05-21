# portfolio.py
import pandas as pd
from pathlib import Path

from models import PortfolioPosition

BASE_DIR = Path(__file__).resolve().parent
PORTFOLIO_PATH = BASE_DIR / "data" / "portfolio.csv"


def load_portfolio(path: Path = PORTFOLIO_PATH) -> list[PortfolioPosition]:
    """Load portfolio CSV and return a list of PortfolioPosition instances."""
    df = pd.read_csv(path)

    positions: list[PortfolioPosition] = []
    for _, row in df.iterrows():
        positions.append(
            PortfolioPosition(
                ticker=str(row["ticker"]),
                shares=int(row["shares"]),
                avg_cost=float(row["avg_cost"]),
            )
        )

    return positions
