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
from market_hours import is_market_open


def resolve_min_strike(current_price: float, config: ScannerConfig, avg_cost: float = 0.0) -> float:
    """
    Minimum acceptable strike = current_price * (1 + min_strike_pct_above_current).
    Set min_strike_pct_above_current to 0.25 for 25% OTM, 0.30 for 30% OTM.
    With exclude_below_cost, strikes under your average cost are skipped too.
    """
    min_strike = current_price * (1.0 + config.min_strike_pct_above_current)
    if config.exclude_below_cost and avg_cost > 0:
        min_strike = max(min_strike, avg_cost)
    return min_strike


def _below_cost_warning(label: str, pick, avg_cost: float) -> str | None:
    """Selling a call below what you paid locks in a loss if the shares are called away."""
    if pick is None or avg_cost <= 0 or float(pick["strike"]) >= avg_cost:
        return None
    loss = avg_cost - float(pick["strike"])
    return (
        f"The {label} pick's ${float(pick['strike']):,.2f} strike is below your ${avg_cost:,.2f} average cost. "
        f"If your shares are called away you'd sell them ${loss:,.2f} per share below what you paid."
    )


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

    min_strike = resolve_min_strike(current_price, config, position.avg_cost)

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

    # Outside market hours (or when Yahoo has no live quotes at all, e.g. a
    # holiday) bid/ask are empty, so price options at their last trade instead.
    if "bid" in raw_calls.columns and "ask" in raw_calls.columns:
        bid = pd.to_numeric(raw_calls["bid"], errors="coerce").fillna(0)
        ask = pd.to_numeric(raw_calls["ask"], errors="coerce").fillna(0)
        has_live_quotes = bool(((bid > 0) & (ask > 0)).any())
    else:
        has_live_quotes = False
    quotes_live = is_market_open() and has_live_quotes

    filtered = filter_covered_calls(
        raw_calls,
        min_strike_price=min_strike,
        stock_price=current_price,
        config=config,
        use_last_price=not quotes_live,
    )

    if filtered.empty:
        return ScanResult(
            position=position,
            current_price=current_price,
            candidates=pd.DataFrame(),
            income_pick=None,
            balanced_pick=None,
            warnings=["No candidates passed filters."],
            quotes_live=quotes_live,
        )

    bad_quote_count = (filtered["quote_quality"] != "LIVE").sum()
    if quotes_live and bad_quote_count > 0:
        warnings.append(f"{bad_quote_count} candidate(s) have STALE or BAD quotes — verify on broker.")

    enriched = add_estimated_delta(filtered, current_price, risk_free_rate=config.risk_free_rate)
    enriched = add_option_metrics(enriched, current_price)

    missing_delta = enriched["delta"].isna().sum()
    if missing_delta > 0:
        warnings.append(
            f"Couldn't estimate the chance of being called for {missing_delta} option(s), "
            "so the balanced pick may be less accurate."
        )

    scored = score_options(enriched, config=config)
    scored["below_cost_basis"] = (position.avg_cost > 0) & (scored["strike"] < position.avg_cost)
    income_pick, balanced_pick = pick_best_options(scored)

    for label, pick in (("income", income_pick), ("balanced", balanced_pick)):
        w = _below_cost_warning(label, pick, position.avg_cost)
        if w:
            warnings.append(w)

    return ScanResult(
        position=position,
        current_price=current_price,
        candidates=scored,
        income_pick=income_pick,
        balanced_pick=balanced_pick,
        warnings=warnings,
        quotes_live=quotes_live,
    )
