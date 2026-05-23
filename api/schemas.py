# api/schemas.py
"""
Pydantic models for all API request and response bodies.
These are separate from app/models.py dataclasses —
schemas handle serialization/validation at the API boundary.
"""

from __future__ import annotations
from pydantic import BaseModel
from typing import Optional


# ---------------------------------------------------------------------------
# Shared
# ---------------------------------------------------------------------------

class PortfolioSummary(BaseModel):
    ticker: str
    shares: int
    avg_cost: float
    current_price: float
    total_contracts: int
    open_contracts: int
    available_contracts: int


# ---------------------------------------------------------------------------
# Scanner
# ---------------------------------------------------------------------------

class ScanConfig(BaseModel):
    min_dte: int = 20
    max_dte: int = 38
    min_strike_pct: float = 0.20
    min_premium: float = 0.05
    min_volume: int = 10
    min_open_interest: int = 50
    income_weight: float = 0.70
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
    allocation_type: str        # "Income" | "Balanced"
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


# ---------------------------------------------------------------------------
# Positions
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Management
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------

class SettingsResponse(BaseModel):
    min_dte: int
    max_dte: int
    min_strike_pct: float
    min_premium: float
    min_volume: int
    min_open_interest: int
    income_weight: float
    target_delta: float
    buyback_budget_pct: float
    profit_capture_target_pct: float
