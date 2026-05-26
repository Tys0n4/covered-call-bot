# api/routes/positions.py
import sys
from pathlib import Path
from typing import Optional
from fastapi import APIRouter, HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "app"))

from positions_store import load_open_positions, list_all_positions, save_positions, close_position
from api.schemas import PositionOut, PositionIn, ClosePositionRequest

router = APIRouter(prefix="/positions", tags=["positions"])


@router.get("", response_model=list[PositionOut])
async def get_open_positions(ticker: Optional[str] = None):
    """Return open positions. Optionally filter by ticker."""
    positions = load_open_positions()
    if ticker:
        positions = [p for p in positions if p.get("ticker") == ticker]
    return positions


@router.get("/all", response_model=list[PositionOut])
async def get_all_positions(ticker: Optional[str] = None):
    """Return all positions including closed. Optionally filter by ticker."""
    positions = list_all_positions()
    if ticker:
        positions = [p for p in positions if p.get("ticker") == ticker]
    return positions


@router.post("", response_model=dict)
async def add_position(position: PositionIn):
    """Manually add a single open position."""
    from models import PlannedCall
    planned = PlannedCall(
        ticker=position.ticker,
        expiry=position.expiry,
        strike=position.strike,
        contracts=position.contracts,
        entry_price=position.entry_price,
        premium_total=position.premium_total,
        premium_source=position.premium_source,
        quote_quality=position.quote_quality,
        allocation_type=position.allocation_type,
    )
    save_positions([planned])
    return {"saved": 1}


@router.post("/close")
async def close_open_position(request: ClosePositionRequest):
    """Mark a position as closed by ID."""
    success = close_position(request.position_id)
    if not success:
        raise HTTPException(status_code=404, detail=f"Position {request.position_id} not found.")
    return {"closed": request.position_id}
