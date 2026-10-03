# api/routes/performance.py
from fastapi import APIRouter

from core.clock import local_today
from core.performance import compute_performance
from core.portfolio import load_portfolio
from core.positions import list_all_positions

router = APIRouter(prefix="/performance", tags=["performance"])


@router.get("")
def get_performance():
    """Realized results: summary, month by month, and every finished call (see app/performance.py)."""
    avg_costs = {h.ticker: h.avg_cost for h in load_portfolio()}
    return compute_performance(list_all_positions(), avg_costs, local_today())
