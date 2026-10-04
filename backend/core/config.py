# config.py
from dataclasses import dataclass



@dataclass(frozen=True)
class ScannerConfig:
    # --- DTE window ---
    min_dte: int = 14
    max_dte: int = 30

    # --- Strike constraints ---
    min_strike_pct_above_current: float = 0.0   # optional extra floor; the delta range is the main risk rule
    max_strike_multiple: float = 1.40
    exclude_below_cost: bool = False             # skip strikes under your average cost per share
    avoid_earnings: bool = False                 # skip expiries on or after the next earnings date

    # --- Quote quality ---
    min_premium: float = 0.10
    min_volume: int = 10
    min_open_interest: int = 50              # ensures you can get filled and buy back
    max_spread_pct: float = 0.35             # max (ask-bid)/mid — filters wide/illiquid spreads
    sell_fill_share: float = 0.25            # selling usually fills this far from the bid toward the ask
    default_fee_per_contract: float = 0.65   # commission per contract until you've recorded your own

    # --- Greeks ---
    risk_free_rate: float = 0.04
    # Sell calls with this chance of being called (delta). Balanced picks sit near the
    # low end, income picks go as high as the monthly goal needs, never past the top.
    delta_min: float = 0.20
    delta_max: float = 0.30

    # --- Allocation ---
    income_weight: float = 0.70

    # --- Buyback / management ---
    buyback_budget_pct: float = 0.15
    profit_capture_target_pct: float = 85.0
    # When earnings or a Fed meeting comes before expiry, buy back once this much is kept
    event_buyback_pct: float = 65.0
    # Past the target, a call this close to expiry with the stock this far below the
    # strike is better left to expire: buying back mostly pays the spread and fees
    let_expire_days: int = 7
    let_expire_cushion: float = 0.05

    # Tolerance for float-based strike matching (dollars)
    strike_match_tolerance: float = 0.01


DEFAULT_CONFIG = ScannerConfig()
