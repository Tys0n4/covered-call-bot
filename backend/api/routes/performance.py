from fastapi import APIRouter

from core.clock import local_today
from core.market_data import get_close_on
from core.parallel import parallel_map
from core.performance import compute_performance
from core.portfolio import load_portfolio
from core.positions import list_all_positions

router = APIRouter(prefix="/performance", tags=["performance"])


@router.get("")
def get_performance():
    """
    Realized results: summary, month by month, and every finished call (see core/performance.py).
    Plain `def`: comparing with just holding needs the stock's close on each
    assignment day (saved once known, else fetched side by side).
    """
    avg_costs = {h.ticker: h.avg_cost for h in load_portfolio()}
    positions = list_all_positions()
    assigned = [p for p in positions if p["status"] == "ASSIGNED" and p.get("closed_at")]
    found = parallel_map(lambda p: get_close_on(p["ticker"], p["closed_at"][:10]), assigned)
    closes = {p["id"]: close for p, close in zip(assigned, found, strict=True) if close}
    return compute_performance(positions, avg_costs, local_today(), assignment_closes=closes)
