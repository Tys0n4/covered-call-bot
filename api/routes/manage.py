# api/routes/manage.py
import sys
from pathlib import Path
from typing import Optional
from fastapi import APIRouter

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "app"))

from strategy import effective_config
from positions_store import load_open_positions
from management import evaluate_positions
from api.schemas import ManagementResponse, EvaluatedPosition

router = APIRouter(prefix="/manage", tags=["management"])


@router.get("", response_model=ManagementResponse)
def evaluate_open_positions(ticker: Optional[str] = None):
    """
    Evaluate open positions for buyback. Optionally filter by ticker.

    Plain `def` so FastAPI runs it in a worker thread: it fetches option
    chains over the network, which would otherwise freeze other requests.
    """
    open_positions = load_open_positions()
    if ticker:
        open_positions = [p for p in open_positions if p.get("ticker") == ticker.upper()]

    # evaluate_positions returns one result per position, in the same order,
    # so pair them directly; matching by ticker/expiry/strike mixes up
    # positions that share an option.
    results = evaluate_positions(open_positions, config=effective_config()) if open_positions else []

    evaluated = [
        EvaluatedPosition(
            id=pos["id"],
            ticker=r.ticker,
            expiry=r.expiry,
            strike=r.strike,
            contracts=r.contracts,
            entry_price=r.entry_price,
            current_option_price=r.current_option_price,
            profit_capture_pct=r.profit_capture_pct,
            should_buy_back=r.should_buy_back,
            cost_to_close=round(r.current_option_price * r.contracts * 100, 2),
            allocation_type=pos.get("allocation_type", ""),
            opened_at=pos.get("opened_at", ""),
        )
        for pos, r in zip(open_positions, results, strict=True)
    ]
    evaluated.sort(key=lambda x: (not x.should_buy_back, -x.profit_capture_pct))

    return ManagementResponse(
        positions_evaluated=len(evaluated),
        buyback_recommended=sum(1 for e in evaluated if e.should_buy_back),
        positions=evaluated,
    )
