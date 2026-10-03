# api/routes/settings.py
# Your strategy (Strategy page). Stored in the database; used by scan, manage and portfolio.
from fastapi import APIRouter

from core.strategy import load_strategy, save_strategy
from api.schemas import StrategySettings

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("", response_model=StrategySettings)
def get_settings():
    """Return your saved strategy (or the defaults if you haven't saved one)."""
    return load_strategy()


@router.put("", response_model=StrategySettings)
def update_settings(settings: StrategySettings):
    """Save your strategy. Takes effect on the next scan, price check and dashboard load."""
    return save_strategy(settings.model_dump())
