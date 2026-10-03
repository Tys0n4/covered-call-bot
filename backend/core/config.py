# config.py
from dataclasses import dataclass

# Strikes closer than this to the stock price are never considered
MIN_STRIKE_PCT = 0.15


@dataclass(frozen=True)
class ScannerConfig:
    # --- DTE window ---
    min_dte: int = 20
    max_dte: int = 38

    # --- Strike constraints ---
    min_strike_pct_above_current: float = MIN_STRIKE_PCT   # 15% OTM minimum
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
    target_delta: float = 0.12              # balanced pick aims for ~12% chance of being called (fits the 15%+ distance)

    # --- Allocation ---
    income_weight: float = 0.70

    # --- Buyback / management ---
    buyback_budget_pct: float = 0.15
    profit_capture_target_pct: float = 80.0
    # Past the target, a call this close to expiry with the stock this far below the
    # strike is better left to expire: buying back mostly pays the spread and fees
    let_expire_days: int = 7
    let_expire_cushion: float = 0.05

    # --- Scoring weights ---
    # Income: annualized yield weighted heavily for fair cross-DTE comparison
    income_yield_weight: float = 0.70
    income_volume_weight: float = 0.30

    # Balanced: rewards delta near target, upside, and annualized yield
    balanced_yield_weight: float = 0.30
    balanced_upside_weight: float = 0.30
    balanced_delta_weight: float = 0.40     # raised — delta proximity is the key differentiator

    # Tolerance for float-based strike matching (dollars)
    strike_match_tolerance: float = 0.01


DEFAULT_CONFIG = ScannerConfig()
