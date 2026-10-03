# api/schemas.py
from __future__ import annotations

import re
from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from core.config import MIN_STRIKE_PCT

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
    min_strike_pct: float = Field(default=MIN_STRIKE_PCT, ge=MIN_STRIKE_PCT, le=1)   # 0.15 = strikes 15%+ above price
    min_premium: float = Field(default=0.05, ge=0, le=1000)
    min_volume: int = Field(default=10, ge=0, le=10_000_000)
    min_open_interest: int = Field(default=50, ge=0, le=10_000_000)
    exclude_below_cost: bool = False   # skip strikes below your average cost per share
    avoid_earnings: bool = False       # skip expiries on or after the next earnings date

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
    spans_earnings: bool = False     # expires on/after the next earnings date
    spans_ex_dividend: bool = False  # expires on/after the next ex-dividend date


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
    earnings_date: Optional[str] = None      # next earnings date, if known
    ex_dividend_date: Optional[str] = None   # next ex-dividend date, if known
    next_market_open: Optional[str] = None   # ISO time of the next open, when closed


class TradeIn(BaseModel):
    """A covered call you sold. Checked against your shares before it's saved."""
    ticker: str
    expiry: str
    strike: float = Field(gt=0, le=1_000_000)
    contracts: int = Field(ge=1, le=100_000)
    entry_price: float = Field(ge=0, le=1_000_000)        # premium per share you were filled at
    allocation_type: Literal["Income", "Balanced"]
    fees: float = Field(default=0, ge=0, le=100_000)      # commissions/fees for this trade, in dollars
    # Ignored if sent: always entry_price x contracts x 100 (kept so older clients still work)
    premium_total: Optional[float] = None

    @property
    def premium(self) -> float:
        return round(self.entry_price * self.contracts * 100, 2)

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
    status: str                              # OPEN, CLOSED (bought back), EXPIRED or ASSIGNED
    opened_at: str
    closed_at: Optional[str] = None
    close_cost: Optional[float] = None       # $ paid to buy it back (0 when expired or assigned)
    open_fees: Optional[float] = None        # $ commissions when sold
    close_fees: Optional[float] = None       # $ commissions when bought back
    cost_basis: Optional[float] = None       # avg cost per share of the stock when sold
    rolled_from: Optional[int] = None        # id of the call this one replaced


class ClosePositionRequest(BaseModel):
    position_id: int
    close_cost: Optional[float] = Field(default=None, ge=0, le=10_000_000)   # $ paid to buy back
    close_fees: Optional[float] = Field(default=None, ge=0, le=100_000)      # $ commissions


class RollRequest(BaseModel):
    """Buy back an open call and sell a new one on the same shares."""
    close_cost: float = Field(ge=0, le=10_000_000)          # $ paid to buy the old call back
    close_fees: float = Field(default=0, ge=0, le=100_000)
    expiry: str
    strike: float = Field(gt=0, le=1_000_000)
    contracts: int = Field(ge=1, le=100_000)
    entry_price: float = Field(ge=0, le=1_000_000)          # new call's fill, per share
    open_fees: float = Field(default=0, ge=0, le=100_000)

    @field_validator("expiry")
    @classmethod
    def _norm_expiry(cls, v):
        return _iso_date(v)


class EditPositionRequest(BaseModel):
    """Fix what was recorded for a trade. Send only the fields to change."""
    entry_price: Optional[float] = Field(default=None, ge=0, le=1_000_000)   # fill per share
    open_fees: Optional[float] = Field(default=None, ge=0, le=100_000)
    close_cost: Optional[float] = Field(default=None, ge=0, le=10_000_000)   # $ paid to buy back
    close_fees: Optional[float] = Field(default=None, ge=0, le=100_000)

    @model_validator(mode="after")
    def _something(self):
        if not self.model_dump(exclude_none=True):
            raise ValueError("send at least one field to change")
        return self


class AssignRequest(BaseModel):
    assigned_on: Optional[str] = None   # YYYY-MM-DD; default: expiry (if expired) or today

    @field_validator("assigned_on")
    @classmethod
    def _date(cls, v):
        return None if v in (None, "") else _iso_date(v)


class AssignmentReviewItem(PositionOut):
    close_price: float                       # the stock's close on expiry day


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
    checked_at: str                          # ISO time (UTC) the prices were fetched
    market_open: bool                        # False: prices are from the last close
    next_market_open: Optional[str] = None   # ISO time of the next open, when closed


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
