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


@dataclass
class ScanResult:
    position: PortfolioPosition
    current_price: float
    candidates: object              # pd.DataFrame
    income_pick: object | None
    balanced_pick: object | None
    warnings: list[str] = field(default_factory=list)
