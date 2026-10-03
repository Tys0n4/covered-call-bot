# api/routes/positions.py
import sys
from pathlib import Path
from typing import Optional
from fastapi import APIRouter, HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "app"))

from assignment_service import calls_to_review
from models import PlannedCall
from positions_store import (
    CoverageError, PositionError, assign_position, close_position, dismiss_assignment, edit_position,
    list_all_positions, load_open_positions, roll_position, save_positions, undo_position,
)
from api.schemas import (
    AssignRequest, AssignmentReviewItem, ClosePositionRequest, EditPositionRequest, PositionIn,
    PositionOut, RollRequest,
)

router = APIRouter(prefix="/positions", tags=["positions"])

# Handlers are plain `def` so FastAPI runs them in a worker thread; the
# database and network calls inside would otherwise block every other request.


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


@router.get("/assignment-review", response_model=list[AssignmentReviewItem])
def get_assignment_review():
    """
    Recently expired calls where the stock closed above the strike on expiry
    day, so your shares were probably called away. Confirm each one with
    /assign or /not-assigned.
    """
    return calls_to_review()


@router.post("", response_model=dict, status_code=201)
def add_position(position: PositionIn):
    """Manually add a single open position. Refused if your shares don't cover it."""
    planned = PlannedCall(
        ticker=position.ticker,
        expiry=position.expiry,
        strike=position.strike,
        contracts=position.contracts,
        entry_price=position.entry_price,
        premium_total=position.premium,
        premium_source=position.premium_source,
        quote_quality=position.quote_quality,
        allocation_type=position.allocation_type,
        fees=position.fees,
    )
    try:
        save_positions([planned], opened_at=position.opened_at)
    except CoverageError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    return {"saved": 1}


@router.post("/close")
def close_open_position(request: ClosePositionRequest):
    """Mark a position as closed (bought back) by ID."""
    success = close_position(request.position_id, close_cost=request.close_cost, close_fees=request.close_fees)
    if not success:
        raise HTTPException(status_code=404, detail=f"No open position with id {request.position_id}.")
    return {"closed": request.position_id}


@router.post("/{position_id}/roll")
def roll_open_position(position_id: int, request: RollRequest):
    """Buy back an open call and sell a new one on the same shares, in one step."""
    new_call = PlannedCall(
        ticker="",            # filled in from the old call
        expiry=request.expiry,
        strike=request.strike,
        contracts=request.contracts,
        entry_price=request.entry_price,
        premium_total=round(request.entry_price * request.contracts * 100, 2),
        premium_source="MID",
        quote_quality="LIVE",
        fees=request.open_fees,
    )
    try:
        new_id = roll_position(position_id, new_call, close_cost=request.close_cost, close_fees=request.close_fees)
    except CoverageError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    except PositionError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    if new_id is None:
        raise HTTPException(status_code=404, detail=f"No open position with id {position_id}.")
    return {"closed": position_id, "opened": new_id}


@router.post("/{position_id}/assign", response_model=PositionOut)
def assign_open_position(position_id: int, request: Optional[AssignRequest] = None):
    """
    Record that the call was exercised and your shares were sold at the
    strike. Removes those shares from your holding.
    """
    try:
        pos = assign_position(position_id, assigned_on=request.assigned_on if request else None)
    except PositionError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    if pos is None:
        raise HTTPException(status_code=404, detail=f"No open or expired position with id {position_id}.")
    return pos


@router.post("/{position_id}/not-assigned")
def mark_not_assigned(position_id: int):
    """You checked with your broker: this expired call was not assigned."""
    if not dismiss_assignment(position_id):
        raise HTTPException(status_code=404, detail=f"No expired position with id {position_id}.")
    return {"reviewed": position_id}


@router.patch("/{position_id}", response_model=PositionOut)
def edit_trade(position_id: int, request: EditPositionRequest):
    """Fix a trade's fill price, fees or (for bought-back calls) buyback cost."""
    try:
        pos = edit_position(position_id, request.model_dump(exclude_none=True))
    except PositionError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    if pos is None:
        raise HTTPException(status_code=404, detail=f"No position with id {position_id}.")
    return pos


@router.post("/{position_id}/undo")
def undo_trade(position_id: int):
    """
    Undo a buyback, roll or assignment: the call is open again (a roll's new
    call is removed; an assignment's shares go back into your holding).
    """
    try:
        result = undo_position(position_id)
    except PositionError as e:   # includes CoverageError
        raise HTTPException(status_code=409, detail=str(e)) from e
    if result is None:
        raise HTTPException(status_code=404, detail=f"No position with id {position_id}.")
    return result
