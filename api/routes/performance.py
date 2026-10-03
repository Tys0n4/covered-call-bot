# api/routes/performance.py
import sys
from pathlib import Path
from fastapi import APIRouter

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "app"))

from clock import local_today
from performance import compute_performance
from portfolio import load_portfolio
from positions_store import list_all_positions

router = APIRouter(prefix="/performance", tags=["performance"])


@router.get("")
def get_performance():
    """Realized results: summary, month by month, and every finished call (see app/performance.py)."""
    avg_costs = {h.ticker: h.avg_cost for h in load_portfolio()}
    return compute_performance(list_all_positions(), avg_costs, local_today())
