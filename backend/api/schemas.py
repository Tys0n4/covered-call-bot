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
    # Expiry window: from your saved strategy unless given here
    min_dte: Optional[int] = Field(default=None, ge=0, le=365)
    max_dte: Optional[int] = Field(default=None, ge=1, le=730)
    min_strike_pct: float = Field(default=0.0, ge=0, le=1)     # optional floor: 0.05 = strikes 5%+ above price
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
        if self.min_dte is not None and self.max_dte is not None and self.max_dte < self.min_dte:
            raise ValueError("max_dte must be at least min_dte")
        return self


class Candidate(BaseModel):
    expiry: str
    dte: int
    strike: float
    premium_price: float                 # likely fill per share when selling (not the midpoint)
    premium_per_contract: float
    net_per_contract: float              # per contract after your usual commission
    annualized_yield_pct: float          # on the net premium
    upside_to_strike_pct: float
    delta: Optional[float]
    spread_pct: Optional[float]
    quote_quality: str                   # LIVE | STALE (last trade, market closed) | OLD (traded before the latest session) | BAD
    last_trade_date: Optional[str] = None  # New York date of the last trade, when known
    below_cost_basis: bool = False   # strike is under your average cost per share
    spans_earnings: bool = False     # expires on/after the next earnings date
    spans_ex_dividend: bool = False  # expires on/after the next ex-dividend date
    spans_fed: bool = False          # expires on/after a Fed rate decision
    spans_industry: bool = False     # expires on/after earnings from the industry's leaders / your stocks in it
    monthly_per_contract: Optional[float] = None   # expected to keep per contract per month (after the buy-back and both commissions)


class PremiumCheck(BaseModel):
    """Are premiums rich or thin right now? (core/volatility.py)"""
    level: Literal["rich", "normal", "thin"]
    implied_vol: float      # what near-the-money options are priced for, per year (0.30 = 30%)
    realized_vol: float     # how much the stock actually moved over the last 20 trading days, per year


class GoalCheck(BaseModel):
    """How the picks compare with the pace your monthly goal needs."""
    goal: float                  # monthly goal ($)
    contracts: int               # contracts across all your stocks
    pace_per_contract: float     # goal ÷ contracts: monthly income each contract needs
    plan_per_contract: float     # what the picks are expected to keep per contract per month (blended by your split)
    met: bool


class RelatedEarnings(BaseModel):
    ticker: str
    date: str
    why: Literal["leader", "yours"]   # an industry leader, or another stock you hold in the industry


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
    net_premium: float                       # premium − buyback reserve − estimated fees
    estimated_fees: float = 0.0              # commission for the planned contracts
    fee_per_contract: float = 0.0            # your usual commission per contract
    premium_check: Optional[PremiumCheck] = None
    data_source: Optional[str] = None        # option prices from "cboe" (15-min delayed) or "yahoo" (fallback)
    price_source: Optional[str] = None       # stock price from "cboe" (same snapshot), "alpha_vantage" or "yahoo"
    delta_min: float = 0.20                  # the strategy used for this scan
    delta_max: float = 0.30
    min_dte: int = 14
    max_dte: int = 30
    goal_check: Optional[GoalCheck] = None
    fed_dates: list[str] = []                # Fed decisions within the expiry window
    industry_earnings: list[RelatedEarnings] = []
    warnings: list[str]
    quotes_live: bool = True                 # False = priced at last trades (market closed)
    earnings_date: Optional[str] = None      # next earnings date, if known
    ex_dividend_date: Optional[str] = None   # next ex-dividend date, if known
    next_market_open: Optional[str] = None   # ISO time of the next open, when closed
    quotes_live_at: Optional[str] = None     # ISO time delayed quotes catch up, in the first 15 min after the open


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
    action: Literal["buy_back", "let_expire", "hold"] = "hold"
    days_left: Optional[int] = None
    stock_price: Optional[float] = None
    cost_to_close: float                     # to buy it back now, including your usual commission
    target_pct: Optional[float] = None       # buy-back target applied (lower before earnings / a Fed meeting)
    buyback_price: Optional[float] = None    # buy back at this price per share or less (the target at the closest cent)
    buyback_kept_pct: Optional[float] = None # share of premium kept at buyback_price
    event: Optional[dict] = None             # {"kind": "earnings" | "fed", "date"} before expiry
    old_trade_date: Optional[str] = None     # no current price: the last trade is from before the latest session
    price_source: Optional[str] = None       # "cboe" | "yahoo"
    allocation_type: str
    opened_at: str


class ManagementResponse(BaseModel):
    positions_evaluated: int
    buyback_recommended: int
    positions: list[EvaluatedPosition]
    checked_at: str                          # ISO time (UTC) the prices were fetched
    market_open: bool                        # False: prices are from the last close
    next_market_open: Optional[str] = None   # ISO time of the next open, when closed
    quotes_live_at: Optional[str] = None     # ISO time delayed quotes catch up, in the first 15 min after the open
    data_source: Optional[str] = None        # option prices from "cboe", "yahoo" or "mixed"


class HoldingIn(BaseModel):
    """A stock you own. Each 100 shares lets you sell one covered call."""
    ticker: str
    shares: int = Field(ge=0, le=10_000_000)
    avg_cost: float = Field(ge=0, le=1_000_000)


class HoldingUpdate(BaseModel):
    shares: int = Field(ge=0, le=10_000_000)
    avg_cost: float = Field(ge=0, le=1_000_000)


class StrategySettings(BaseModel):
    """Your strategy, as shown and edited on the Strategy page. Fields left out keep their saved value."""
    income_weight: float = Field(ge=0, le=1)                       # 0.70 = 70% income
    profit_capture_target_pct: float = Field(ge=1, le=100)         # 85 = buy back at 85% kept
    buyback_budget_pct: float = Field(ge=0, le=1)                  # 0.15 = 15% set aside
    monthly_goal: float = Field(default=0, ge=0, le=10_000_000)    # dollars per month, 0 = off
    delta_min: Optional[float] = Field(default=None, ge=0.05, le=0.6)   # 0.20 = 20% chance of being called
    delta_max: Optional[float] = Field(default=None, ge=0.05, le=0.6)
    min_dte: Optional[int] = Field(default=None, ge=1, le=120)          # expiry window, days
    max_dte: Optional[int] = Field(default=None, ge=1, le=120)
    event_buyback_pct: Optional[float] = Field(default=None, ge=10, le=100)  # 65 = buy back at 65% before events
    commission_per_contract: Optional[float] = Field(default=None, ge=0, le=10)  # dollars per option contract

    @model_validator(mode="after")
    def _ranges(self):
        if self.delta_min is not None and self.delta_max is not None and self.delta_min >= self.delta_max:
            raise ValueError("The lowest chance of being called must be below the highest")
        if self.min_dte is not None and self.max_dte is not None and self.min_dte >= self.max_dte:
            raise ValueError("The shortest expiry must be before the longest")
        if self.event_buyback_pct is not None and self.event_buyback_pct > self.profit_capture_target_pct:
            raise ValueError("The buy-back target before events can't be above your usual target")
        return self


class EarningsDate(BaseModel):
    ticker: str
    date: str


class UpcomingEvents(BaseModel):
    """Dashboard "Coming up": Fed decisions and your holdings' earnings in the next few weeks."""
    fed: list[str]
    fed_known_until: Optional[str] = None     # the Fed calendar has no dates past this
    earnings: list[EarningsDate]
    earnings_unknown: list[str] = []          # stocks whose earnings date couldn't be checked


class AlertSettingsIn(BaseModel):
    """Change buy-back alert settings; fields left out stay as they are."""
    discord_webhook: Optional[str] = Field(default=None, max_length=300)
    enabled: Optional[bool] = None
    clear_webhook: bool = False          # remove the saved webhook (also turns alerts off)


class AlertSettingsOut(BaseModel):
    enabled: bool
    webhook_set: bool
    webhook_hint: Optional[str] = None   # last few characters, so you can tell which one is saved
    last_check_at: Optional[str] = None  # ISO time (UTC) of the last scheduled check


class AlertCheckResult(BaseModel):
    status: Literal["ok", "off", "market_closed"]
    sent: int
    checked: Optional[int] = None
