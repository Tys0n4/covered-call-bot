# models.py
from __future__ import annotations
from dataclasses import dataclass, field


@dataclass
class PortfolioPosition:
    ticker: str
    shares: int
    avg_cost: float
    # min_sale_price removed — minimum strike is now driven purely by
    # current_price * config.min_strike_pct_above_current

    @property
    def total_contracts(self) -> int:
        return self.shares // 100


@dataclass
class PlannedCall:
    ticker: str
    expiry: str
    strike: float
    contracts: int
    entry_price: float
    premium_total: float
    premium_source: str = "NONE"
    quote_quality: str = "BAD"
    warning: str = "Verify on broker"
    status: str = "OPEN"
    allocation_type: str = ""   # "Income" | "Balanced"
    fees: float = 0.0           # commissions/fees paid when selling ($ total)


@dataclass
class OpenCoveredCall:
    ticker: str
    expiry: str
    strike: float
    contracts: int
    entry_price: float
    current_option_price: float = 0.0
    profit_capture_pct: float = 0.0
    should_buy_back: bool = False
    action: str = "hold"            # "buy_back" | "let_expire" | "hold"
    days_left: int | None = None    # calendar days until expiry
    stock_price: float | None = None
    cost_to_close: float = 0.0      # ask × shares + commission, in dollars
    target_pct: float = 0.0         # the buy-back target applied (lower before an event)
    buyback_price: float = 0.0      # buy back at this price per share or less: the target at the closest cent
    buyback_kept_pct: float = 0.0   # share of premium kept at buyback_price
    event: dict | None = None       # {"kind": "earnings" | "fed", "date"} before expiry, if any


@dataclass
class ScanResult:
    position: PortfolioPosition
    current_price: float
    candidates: object              # pd.DataFrame
    income_pick: object | None
    balanced_pick: object | None
    warnings: list[str] = field(default_factory=list)
    quotes_live: bool = True        # False = last traded prices (market closed / no live quotes)
    events: dict = field(default_factory=dict)   # upcoming earnings_date / ex_dividend_date
    fee_per_contract: float = 0.0   # commission per contract used for the estimates
    premium_check: dict | None = None   # rich / normal / thin (see volatility.py)
    plan_per_contract: float = 0.0      # the picks' blended monthly income per contract
