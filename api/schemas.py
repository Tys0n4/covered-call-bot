# api/schemas.py
from __future__ import annotations
from pydantic import BaseModel, Field
from typing import Optional


class ScanConfig(BaseModel):
    ticker: str = "SOFI"        # ← now dynamic
    min_dte: int = 20
    max_dte: int = 38
    min_strike_pct: float = 0.20
    min_premium: float = 0.05
    min_volume: int = 10
    min_open_interest: int = 50
    income_weight: float = 0.70   # ignored: the split now comes from your saved strategy
    target_delta: float = 0.22


class Candidate(BaseModel):
    expiry: str
    dte: int
    strike: float
    premium_price: float
    premium_per_contract: float
    annualized_yield_pct: float
    upside_to_strike_pct: float
    delta: Optional[float]
    spread_pct: Optional[float]
    quote_quality: str
    income_score: Optional[float]
    balanced_score: Optional[float]


class AllocationItem(BaseModel):
    allocation_type: str
    expiry: str
    strike: float
    contracts: int
    entry_price: float
    premium_total: float
    quote_quality: str
    buyback_total: float
    per_contract_budget: float


class ScanResponse(BaseModel):
    ticker: str
    current_price: float
    min_strike: float
    candidates: list[Candidate]
    income_pick: Optional[Candidate]
    balanced_pick: Optional[Candidate]
    allocation_summary: dict
    planned_positions: list[AllocationItem]
    gross_premium: float
    buyback_budget: float
    net_premium: float
    warnings: list[str]


class PositionIn(BaseModel):
    ticker: str
    expiry: str
    strike: float
    contracts: int
    entry_price: float
    premium_total: float
    premium_source: str = "MID"
    quote_quality: str = "LIVE"
    allocation_type: str
    opened_at: str


class PositionOut(BaseModel):
    id: int
    ticker: str
    expiry: str
    strike: float
    contracts: int
    entry_price: float
    premium_total: float
    allocation_type: str
    status: str
    opened_at: str


class ClosePositionRequest(BaseModel):
    position_id: int


class EvaluatedPosition(BaseModel):
    id: int
    ticker: str
    expiry: str
    strike: float
    contracts: int
    entry_price: float
    current_option_price: float
    profit_capture_pct: float
    should_buy_back: bool
    cost_to_close: float
    allocation_type: str
    opened_at: str


class ManagementResponse(BaseModel):
    positions_evaluated: int
    buyback_recommended: int
    positions: list[EvaluatedPosition]


class HoldingIn(BaseModel):
    """A stock you own. Each 100 shares lets you sell one covered call."""
    ticker: str
    shares: int = Field(ge=0, le=10_000_000)
    avg_cost: float = Field(ge=0, le=1_000_000)


class HoldingUpdate(BaseModel):
    shares: int = Field(ge=0, le=10_000_000)
    avg_cost: float = Field(ge=0, le=1_000_000)


class StrategySettings(BaseModel):
    """Your strategy, as shown and edited on the Strategy page."""
    income_weight: float = Field(ge=0, le=1)                       # 0.70 = 70% income
    profit_capture_target_pct: float = Field(ge=1, le=100)         # 80 = buy back at 80% kept
    buyback_budget_pct: float = Field(ge=0, le=1)                  # 0.15 = 15% set aside
    monthly_goal: float = Field(default=0, ge=0, le=10_000_000)    # dollars per month, 0 = off
