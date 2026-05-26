# config.py
from dataclasses import dataclass


@dataclass(frozen=True)
class ScannerConfig:
    # --- DTE window ---
    min_dte: int = 20
    max_dte: int = 38

    # --- Strike constraints ---
    min_strike_pct_above_current: float = 0.20   # 20% OTM minimum
    max_strike_multiple: float = 1.40

    # --- Quote quality ---
    min_premium: float = 0.10
    min_volume: int = 10
    min_open_interest: int = 50              # ensures you can get filled and buy back
    max_spread_pct: float = 0.50             # max (ask-bid)/mid — filters wide/illiquid spreads

    # --- Greeks ---
    risk_free_rate: float = 0.04
    target_delta: float = 0.22              # raised from 0.14 — better risk/reward sweet spot

    # --- Allocation ---
    income_weight: float = 0.70

    # --- Buyback / management ---
    buyback_budget_pct: float = 0.15
    profit_capture_target_pct: float = 80.0

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
