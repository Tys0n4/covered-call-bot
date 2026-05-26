# api/routes/manage.py
import sys
from pathlib import Path
from typing import Optional
from fastapi import APIRouter

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "app"))

from config import DEFAULT_CONFIG
from positions_store import load_open_positions, list_all_positions
from management import evaluate_positions
from api.schemas import ManagementResponse, EvaluatedPosition

router = APIRouter(prefix="/manage", tags=["management"])


@router.get("", response_model=ManagementResponse)
async def evaluate_open_positions(ticker: Optional[str] = None):
    """
    Evaluate open positions for buyback. Optionally filter by ticker.
    """
    all_open = load_open_positions()

    if ticker:
        open_positions = [p for p in all_open if p.get("ticker") == ticker]
    else:
        open_positions = all_open

    if not open_positions:
        return ManagementResponse(
            positions_evaluated=0,
            buyback_recommended=0,
            positions=[],
        )

    results = evaluate_positions(open_positions, config=DEFAULT_CONFIG)

    evaluated = []
    for r in results:
        matched = next(
            (p for p in open_positions
             if p["ticker"] == r.ticker
             and p["expiry"] == r.expiry
             and abs(p["strike"] - r.strike) < 0.01),
            {}
        )
        evaluated.append(EvaluatedPosition(
            id=matched.get("id", 0),
            ticker=r.ticker,
            expiry=r.expiry,
            strike=r.strike,
            contracts=r.contracts,
            entry_price=r.entry_price,
            current_option_price=r.current_option_price,
            profit_capture_pct=r.profit_capture_pct,
            should_buy_back=r.should_buy_back,
            cost_to_close=round(r.current_option_price * r.contracts * 100, 2),
            allocation_type=matched.get("allocation_type", ""),
            opened_at=matched.get("opened_at", ""),
        ))

    evaluated.sort(key=lambda x: (not x.should_buy_back, -x.profit_capture_pct))

    return ManagementResponse(
        positions_evaluated=len(evaluated),
        buyback_recommended=sum(1 for e in evaluated if e.should_buy_back),
        positions=evaluated,
    )
