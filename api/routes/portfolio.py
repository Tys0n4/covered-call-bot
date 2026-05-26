# api/routes/portfolio.py
import sys
from pathlib import Path
from fastapi import APIRouter

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "app"))

from portfolio import load_portfolio
from positions_store import load_open_positions
from config import DEFAULT_CONFIG

router = APIRouter(prefix="/portfolio", tags=["portfolio"])


@router.get("")
async def get_portfolio():
    """
    Return all tickers in the portfolio with contract stats.
    Used by the frontend ticker selector and dashboard.
    """
    positions = load_portfolio()
    open_positions = load_open_positions()
    config = DEFAULT_CONFIG

    result = []
    for pos in positions:
        total_contracts = pos.shares // 100
        target_income   = round(total_contracts * config.income_weight)
        target_balanced = total_contracts - target_income

        open_income = sum(
            p["contracts"] for p in open_positions
            if p.get("status") == "OPEN"
            and p.get("ticker") == pos.ticker
            and p.get("allocation_type") == "Income"
        )
        open_balanced = sum(
            p["contracts"] for p in open_positions
            if p.get("status") == "OPEN"
            and p.get("ticker") == pos.ticker
            and p.get("allocation_type") == "Balanced"
        )
        open_total    = open_income + open_balanced
        available     = total_contracts - open_total
        gross_premium = sum(
            p["premium_total"] for p in open_positions
            if p.get("status") == "OPEN"
            and p.get("ticker") == pos.ticker
        )

        result.append({
            "ticker":          pos.ticker,
            "shares":          pos.shares,
            "avg_cost":        pos.avg_cost,
            "total_contracts": total_contracts,
            "target_income":   target_income,
            "target_balanced": target_balanced,
            "open_income":     open_income,
            "open_balanced":   open_balanced,
            "open_total":      open_total,
            "available":       available,
            "gross_premium":   round(gross_premium, 2),
        })

    return result
