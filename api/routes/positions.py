# api/routes/positions.py
import sys
from pathlib import Path
from typing import Optional
from fastapi import APIRouter, HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "app"))

from models import PlannedCall
from positions_store import (
    CoverageError, close_position, list_all_positions, load_open_positions, save_positions,
)
from api.schemas import PositionOut, PositionIn, ClosePositionRequest

router = APIRouter(prefix="/positions", tags=["positions"])

# Handlers are plain `def` so FastAPI runs them in a worker thread; the
# database calls inside would otherwise block every other request.


@router.get("", response_model=list[PositionOut])
def get_open_positions(ticker: Optional[str] = None):
    """Return open positions. Optionally filter by ticker."""
    positions = load_open_positions()
    if ticker:
        positions = [p for p in positions if p.get("ticker") == ticker.upper()]
    return positions


@router.get("/all", response_model=list[PositionOut])
def get_all_positions(ticker: Optional[str] = None):
    """Return all positions including closed. Optionally filter by ticker."""
    positions = list_all_positions()
    if ticker:
        positions = [p for p in positions if p.get("ticker") == ticker.upper()]
    return positions


@router.post("", response_model=dict, status_code=201)
def add_position(position: PositionIn):
    """Manually add a single open position. Refused if your shares don't cover it."""
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
    try:
        save_positions([planned], opened_at=position.opened_at)
    except CoverageError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    return {"saved": 1}


@router.post("/close")
def close_open_position(request: ClosePositionRequest):
    """Mark a position as closed by ID."""
    success = close_position(request.position_id, close_cost=request.close_cost)
    if not success:
        raise HTTPException(status_code=404, detail=f"No open position with id {request.position_id}.")
    return {"closed": request.position_id}
