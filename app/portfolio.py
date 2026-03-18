import pandas as pd
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
PORTFOLIO_PATH = BASE_DIR / "data" / "portfolio.csv"

def load_portfolio():
    df = pd.read_csv(PORTFOLIO_PATH)

    portfolio = []

    for _, row in df.iterrows():
        portfolio.append({
            "ticker": row["ticker"],
            "shares": int(row["shares"]),
            "avg_cost": float(row["avg_cost"]),
            "min_sale_price": float(row["target_min_sale_price"])
        })

    return portfolio