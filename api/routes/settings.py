# api/routes/settings.py
import sys
from pathlib import Path
from fastapi import APIRouter

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "app"))

from config import DEFAULT_CONFIG
from api.schemas import SettingsResponse

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("", response_model=SettingsResponse)
async def get_settings():
    """Return current scanner configuration."""
    return SettingsResponse(
        min_dte=DEFAULT_CONFIG.min_dte,
        max_dte=DEFAULT_CONFIG.max_dte,
        min_strike_pct=DEFAULT_CONFIG.min_strike_pct_above_current,
        min_premium=DEFAULT_CONFIG.min_premium,
        min_volume=DEFAULT_CONFIG.min_volume,
        min_open_interest=DEFAULT_CONFIG.min_open_interest,
        income_weight=DEFAULT_CONFIG.income_weight,
        target_delta=DEFAULT_CONFIG.target_delta,
        buyback_budget_pct=DEFAULT_CONFIG.buyback_budget_pct,
        profit_capture_target_pct=DEFAULT_CONFIG.profit_capture_target_pct,
    )
