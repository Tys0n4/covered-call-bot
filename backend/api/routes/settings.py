# api/routes/settings.py
# Your strategy (Strategy page). Stored in the database; used by scan, manage and portfolio.
from fastapi import APIRouter, Depends

from core.strategy import load_strategy, save_strategy
from api.auth import current_user
from api.schemas import StrategySettings

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("", response_model=StrategySettings)
def get_settings(user_id: int = Depends(current_user)):
    """Return your saved strategy (or the defaults if you haven't saved one)."""
    return load_strategy(user_id)


@router.put("", response_model=StrategySettings)
def update_settings(settings: StrategySettings, user_id: int = Depends(current_user)):
    """Save your strategy. Takes effect on the next scan, price check and dashboard load."""
    return save_strategy(user_id, settings.model_dump())
