# scanner_service.py
from __future__ import annotations

from datetime import datetime

import pandas as pd

from config import ScannerConfig, DEFAULT_CONFIG
from models import PortfolioPosition, ScanResult
from market_data import get_current_price, get_events
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


def _target_delta_warning(scored: pd.DataFrame, config: ScannerConfig) -> str | None:
    """
    The balanced pick aims for target_delta. If no candidate gets within half
    of it (e.g. a 20%-above-price minimum only leaves ~3% deltas), both picks
    end up as near-identical far strikes, so say why.
    """
    deltas = pd.to_numeric(scored.get("delta"), errors="coerce").dropna()
    if deltas.empty:
        return None
    target = config.target_delta
    closest = float(deltas.iloc[(deltas - target).abs().argmin()])
    if abs(closest - target) <= target * 0.5:
        return None
    hint = (
        f"lower \"Min. distance above price\" (now {config.min_strike_pct_above_current:.0%}) or the target"
        if closest < target else "raise the target or the minimum distance"
    )
    return (
        f"No option comes close to your {target:.2f} balanced target delta (the closest is {closest:.2f}), "
        f"so the balanced pick is just the best of what's left. To get nearer the target, {hint}."
    )


def _fmt_day(iso: str) -> str:
    d = datetime.strptime(iso, "%Y-%m-%d")
    return f"{d:%b} {d.day}"


def _add_event_flags(df: pd.DataFrame, events: dict) -> pd.DataFrame:
    """Mark options whose expiry is on/after the next earnings or ex-dividend date."""
    df = df.copy()
    earnings, ex_div = events.get("earnings_date"), events.get("ex_dividend_date")
    expiry = df["expiry"].astype(str)
    df["spans_earnings"] = (expiry >= earnings) if earnings else False
    df["spans_ex_dividend"] = (expiry >= ex_div) if ex_div else False
    return df


def _event_warnings(ticker: str, picks, events: dict) -> list[str]:
    picks = [p for p in picks if p is not None]
    out = []
    if any(bool(p.get("spans_earnings")) for p in picks):
        out.append(
            f"{ticker} reports earnings on {_fmt_day(events['earnings_date'])}, before your pick's expiry. "
            "The stock can jump on earnings, which raises the chance your shares are called away. "
            "Turn on \"Skip expiries that span earnings\" to avoid it."
        )
    if any(bool(p.get("spans_ex_dividend")) for p in picks):
        out.append(
            f"{ticker} goes ex-dividend on {_fmt_day(events['ex_dividend_date'])}, before your pick's expiry. "
            "If the stock climbs above your strike, the buyer may exercise early (the day before) "
            "to collect the dividend."
        )
    return out


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

    events = get_events(position.ticker)
    if not filtered.empty:
        filtered = _add_event_flags(filtered, events)
        if config.avoid_earnings and events.get("earnings_date"):
            kept = filtered[~filtered["spans_earnings"]]
            if kept.empty:
                warnings.append(
                    f"Every option in your expiry window is on or after {position.ticker}'s earnings "
                    f"({_fmt_day(events['earnings_date'])}). Shorten the expiry window or allow earnings."
                )
            filtered = kept

    if filtered.empty:
        return ScanResult(
            position=position,
            current_price=current_price,
            candidates=pd.DataFrame(),
            income_pick=None,
            balanced_pick=None,
            warnings=warnings or ["No candidates passed filters."],
            quotes_live=quotes_live,
            events=events,
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

    w = _target_delta_warning(scored, config)
    if w:
        warnings.append(w)

    for label, pick in (("income", income_pick), ("balanced", balanced_pick)):
        w = _below_cost_warning(label, pick, position.avg_cost)
        if w:
            warnings.append(w)
    warnings.extend(_event_warnings(position.ticker, (income_pick, balanced_pick), events))

    return ScanResult(
        position=position,
        current_price=current_price,
        candidates=scored,
        income_pick=income_pick,
        balanced_pick=balanced_pick,
        warnings=warnings,
        quotes_live=quotes_live,
        events=events,
    )
