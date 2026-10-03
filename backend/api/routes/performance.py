# api/routes/performance.py
from fastapi import APIRouter

from core.clock import local_today
from core.market_data import get_close_on
from core.performance import compute_performance
from core.portfolio import load_portfolio
from core.positions import list_all_positions

router = APIRouter(prefix="/performance", tags=["performance"])


@router.get("")
def get_performance():
    """
    Realized results: summary, month by month, and every finished call (see core/performance.py).
    Plain `def`: comparing with just holding fetches the stock's close on each
    assignment day (cached), over the network.
    """
    avg_costs = {h.ticker: h.avg_cost for h in load_portfolio()}
    positions = list_all_positions()
    closes = {}
    for p in positions:
        if p["status"] == "ASSIGNED" and p.get("closed_at"):
            close = get_close_on(p["ticker"], p["closed_at"][:10])
            if close:
                closes[p["id"]] = close
    return compute_performance(positions, avg_costs, local_today(), assignment_closes=closes)
