# api/schemas.py
from __future__ import annotations

import re
from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

# Same rule as app/portfolio.py: 1–10 characters, letters, digits, dot or dash
_TICKER_RE = re.compile(r"^[A-Z][A-Z0-9.\-]{0,9}$")


def _ticker(v: str) -> str:
    t = (v or "").strip().upper()
    if not _TICKER_RE.match(t):
        raise ValueError(f"'{v}' is not a valid ticker symbol")
    return t


def _iso_date(v: str) -> str:
    try:
        return date.fromisoformat(str(v)[:10]).isoformat()
    except ValueError:
        raise ValueError("must be a date like 2026-10-16") from None


class ScanConfig(BaseModel):
    """Filters from the Scanner page. The split and buyback reserve come from your saved strategy."""
    ticker: str
    min_dte: int = Field(default=20, ge=0, le=365)
    max_dte: int = Field(default=38, ge=1, le=730)
    min_strike_pct: float = Field(default=0.20, ge=0, le=1)          # 0.20 = strikes 20%+ above price
    min_premium: float = Field(default=0.05, ge=0, le=1000)
    min_volume: int = Field(default=10, ge=0, le=10_000_000)
    min_open_interest: int = Field(default=50, ge=0, le=10_000_000)
    target_delta: float = Field(default=0.22, gt=0, lt=1)
    exclude_below_cost: bool = False   # skip strikes below your average cost per share

    @field_validator("ticker")
    @classmethod
    def _norm_ticker(cls, v):
        return _ticker(v)

    @model_validator(mode="after")
    def _dte_window(self):
        if self.max_dte < self.min_dte:
            raise ValueError("max_dte must be at least min_dte")
        return self


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
    below_cost_basis: bool = False   # strike is under your average cost per share


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
    below_cost_basis: bool = False


class ScanResponse(BaseModel):
    ticker: str
    current_price: float
    avg_cost: float = 0.0
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
    quotes_live: bool = True                 # False = priced at last trades (market closed)
    next_market_open: Optional[str] = None   # ISO time of the next open, when closed


class TradeIn(BaseModel):
    """A covered call you sold. Checked against your shares before it's saved."""
    ticker: str
    expiry: str
    strike: float = Field(gt=0, le=1_000_000)
    contracts: int = Field(ge=1, le=100_000)
    entry_price: float = Field(ge=0, le=1_000_000)        # premium per share
    premium_total: float = Field(ge=0, le=1_000_000_000)  # premium for all contracts, in dollars
    allocation_type: Literal["Income", "Balanced"]

    @field_validator("ticker")
    @classmethod
    def _norm_ticker(cls, v):
        return _ticker(v)

    @field_validator("expiry")
    @classmethod
    def _norm_expiry(cls, v):
        return _iso_date(v)


class PositionIn(TradeIn):
    """A trade added by hand (not from a scan)."""
    premium_source: Literal["MID", "LAST", "BID", "ASK", "NONE"] = "MID"
    quote_quality: Literal["LIVE", "STALE", "BAD"] = "LIVE"
    opened_at: Optional[str] = None   # YYYY-MM-DD; today when left out

    @field_validator("opened_at")
    @classmethod
    def _opened(cls, v):
        return None if v in (None, "") else _iso_date(v)


class PositionOut(BaseModel):
    id: int
    ticker: str
    expiry: str
    strike: float
    contracts: int
    entry_price: float
    premium_total: float
    allocation_type: str
    status: str                              # OPEN, CLOSED (bought back) or EXPIRED
    opened_at: str
    closed_at: Optional[str] = None
    close_cost: Optional[float] = None       # $ paid to buy it back (0 when expired)


class ClosePositionRequest(BaseModel):
    position_id: int
    close_cost: Optional[float] = Field(default=None, ge=0, le=10_000_000)   # $ paid to buy back


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
