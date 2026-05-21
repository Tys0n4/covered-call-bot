# scanner_service.py
from __future__ import annotations

import pandas as pd

from config import ScannerConfig, DEFAULT_CONFIG
from models import PortfolioPosition, ScanResult
from market_data import get_current_price
from options_data import get_call_options_in_dte_range
from filters import filter_covered_calls
from calculations import add_option_metrics
from greeks import add_estimated_delta
from scoring import score_options, pick_best_options


def resolve_min_strike(current_price: float, config: ScannerConfig) -> float:
    """
    Minimum acceptable strike = current_price * (1 + min_strike_pct_above_current).
    Set min_strike_pct_above_current to 0.25 for 25% OTM, 0.30 for 30% OTM.
    """
    return current_price * (1.0 + config.min_strike_pct_above_current)


def scan_covered_calls(
    position: PortfolioPosition,
    config: ScannerConfig = DEFAULT_CONFIG,
) -> ScanResult:
    warnings: list[str] = []

    current_price = get_current_price(position.ticker)
    if current_price is None:
        return ScanResult(
            position=position,
            current_price=0.0,
            candidates=pd.DataFrame(),
            income_pick=None,
            balanced_pick=None,
            warnings=[f"Could not fetch price for {position.ticker}"],
        )

    min_strike = resolve_min_strike(current_price, config)

    raw_calls = get_call_options_in_dte_range(
        position.ticker,
        min_dte=config.min_dte,
        max_dte=config.max_dte,
    )

    if raw_calls.empty:
        return ScanResult(
            position=position,
            current_price=current_price,
            candidates=pd.DataFrame(),
            income_pick=None,
            balanced_pick=None,
            warnings=["No options found in DTE window."],
        )

    filtered = filter_covered_calls(
        raw_calls,
        min_strike_price=min_strike,
        stock_price=current_price,
        config=config,
    )

    if filtered.empty:
        return ScanResult(
            position=position,
            current_price=current_price,
            candidates=pd.DataFrame(),
            income_pick=None,
            balanced_pick=None,
            warnings=["No candidates passed filters."],
        )

    bad_quote_count = (filtered["quote_quality"] != "LIVE").sum()
    if bad_quote_count > 0:
        warnings.append(f"{bad_quote_count} candidate(s) have STALE or BAD quotes — verify on broker.")

    enriched = add_estimated_delta(filtered, current_price, risk_free_rate=config.risk_free_rate)
    enriched = add_option_metrics(enriched, current_price)

    missing_delta = enriched["delta"].isna().sum()
    if missing_delta > 0:
        warnings.append(
            f"{missing_delta} candidate(s) have missing delta (bad IV). "
            "Balanced score will apply a zero delta penalty for those rows."
        )

    scored = score_options(enriched, config=config)
    income_pick, balanced_pick = pick_best_options(scored)

    return ScanResult(
        position=position,
        current_price=current_price,
        candidates=scored,
        income_pick=income_pick,
        balanced_pick=balanced_pick,
        warnings=warnings,
    )
