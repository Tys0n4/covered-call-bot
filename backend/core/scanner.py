# scanner.py
from __future__ import annotations

from datetime import datetime

import pandas as pd

from core.config import ScannerConfig, DEFAULT_CONFIG
from core.models import PortfolioPosition, ScanResult
from core.market_data import get_current_price, get_dividend_yield, get_events, get_recent_closes
from core.options_data import get_call_options_in_dte_range
from core.filters import filter_covered_calls
from core.calculations import add_option_metrics
from core.greeks import add_estimated_delta
from core.fees import typical_fee_per_contract
from core.volatility import premium_check, realized_volatility
from core.scoring import add_monthly_income, in_delta_range, pick_for_strategy, recent_prices_only
from core.events import fed_meetings_between, last_fed_meeting, related_earnings
from core.market_hours import is_market_open, last_session, market_today


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


def _fmt_day(iso: str) -> str:
    d = datetime.strptime(iso, "%Y-%m-%d")
    return f"{d:%b} {d.day}"


def _add_event_flags(df: pd.DataFrame, events: dict) -> pd.DataFrame:
    """
    Mark options whose expiry is on/after the next earnings or ex-dividend date,
    a Fed decision, or earnings from the industry's leaders / your stocks in it.
    spans_event = anything that can make the stock jump (not ex-dividend).
    """
    df = df.copy()
    earnings, ex_div = events.get("earnings_date"), events.get("ex_dividend_date")
    fed = events.get("fed_dates") or []
    industry = events.get("industry_earnings") or []
    expiry = df["expiry"].astype(str)
    df["spans_earnings"] = (expiry >= earnings) if earnings else False
    df["spans_ex_dividend"] = (expiry >= ex_div) if ex_div else False
    df["spans_fed"] = (expiry >= fed[0]) if fed else False
    df["spans_industry"] = (expiry >= industry[0]["date"]) if industry else False
    df["spans_event"] = df["spans_earnings"] | df["spans_fed"] | df["spans_industry"]
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
    if any(bool(p.get("spans_fed")) for p in picks):
        out.append(
            f"The Fed announces its rate decision on {_fmt_day(events['fed_dates'][0])}, before your pick's "
            "expiry. Rate news can move the whole market, so the picks stay near the safe end of your range."
        )
    if any(bool(p.get("spans_industry")) for p in picks):
        first = events["industry_earnings"][0]
        names = ", ".join(e["ticker"] for e in events["industry_earnings"][:3])
        out.append(
            f"Others in {ticker}'s industry report earnings before your pick's expiry ({names}; first on "
            f"{_fmt_day(first['date'])}). Their results often move the whole industry, so the picks stay "
            "near the safe end of your range."
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
    *,
    holdings: list[str] | None = None,
    goal_pace: float = 0.0,
) -> ScanResult:
    """
    holdings: your tickers (to flag earnings from your stocks in the same industry).
    goal_pace: monthly income per contract your goal needs (0 = no goal).
    """
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

    source = str(raw_calls["source"].iloc[0]) if "source" in raw_calls.columns else None

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

    events = dict(get_events(position.ticker))
    if events.get("earnings_unknown"):
        warnings.append(
            f"Couldn't check {position.ticker}'s earnings date (Yahoo didn't answer), so these picks don't "
            "account for earnings. Check the date before selling; the app asks Yahoo again in a few minutes."
        )
    today = market_today()
    last_expiry = str(raw_calls["expiry"].max())
    events["fed_dates"] = fed_meetings_between(today, last_expiry)
    known_until = last_fed_meeting()
    if known_until and last_expiry > known_until:
        warnings.append(
            f"The app's Fed calendar ends {_fmt_day(known_until)}, so meetings after that aren't checked "
            "for these expiries. Dates are added once the Fed confirms them."
        )
    events["industry_earnings"] = [
        e for e in related_earnings(position.ticker, holdings or [], today) if e["date"] <= last_expiry
    ]
    check = premium_check(position.ticker, raw_calls, current_price)
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

    # Outside market hours Yahoo's implied volatility is ~0, so delta comes from
    # each option's price instead, or the stock's recent moves as a last resort
    recent_vol = (check or {}).get("realized_vol") or realized_volatility(get_recent_closes(position.ticker) or [])
    enriched = add_estimated_delta(
        filtered, current_price, risk_free_rate=config.risk_free_rate,
        dividend_yield=get_dividend_yield(position.ticker, current_price), fallback_vol=recent_vol,
    )
    fee = typical_fee_per_contract()
    enriched = add_option_metrics(enriched, current_price, fee_per_contract=fee)
    # An option whose commission eats the whole premium isn't income
    enriched = enriched[enriched["net_per_contract"] > 0]
    if enriched.empty:
        return ScanResult(
            position=position, current_price=current_price, candidates=pd.DataFrame(),
            income_pick=None, balanced_pick=None, quotes_live=quotes_live, events=events,
            warnings=warnings + ["Every matching option pays less than the commission to sell it."],
            fee_per_contract=fee, premium_check=check, data_source=source,
        )

    sources = set(enriched["delta_source"].dropna())
    if "price" in sources or "history" in sources:
        how = "last trade prices" + (" and the stock's recent moves" if "history" in sources else "")
        warnings.append(
            f"Live volatility isn't available right now, so the chance of being called is estimated from {how}. "
            "It can shift once the market opens."
        )
    missing_delta = enriched["delta"].isna().sum()
    if missing_delta > 0:
        warnings.append(
            f"Couldn't estimate the chance of being called for {missing_delta} option(s), "
            "so the balanced pick may be less accurate."
        )

    scored = add_monthly_income(enriched, config, fee)
    # Options that would keep nothing after the buy-back and commissions aren't income
    scored = scored[scored["monthly_per_contract"] > 0]
    scored["below_cost_basis"] = (position.avg_cost > 0) & (scored["strike"] < position.avg_cost)

    # Your delta range is the main risk rule: only those options are candidates
    in_range = in_delta_range(scored, config)
    if in_range.empty:
        return ScanResult(
            position=position, current_price=current_price, candidates=pd.DataFrame(),
            income_pick=None, balanced_pick=None, quotes_live=quotes_live, events=events,
            warnings=warnings + [
                f"None of the {len(scored)} options in your expiry window has a "
                f"{config.delta_min:.0%}–{config.delta_max:.0%} chance of being called. "
                "Widen the range or the expiry window on the Strategy page."
            ],
            fee_per_contract=fee, premium_check=check, data_source=source,
        )
    old = int((in_range["quote_quality"] == "OLD").sum()) if "quote_quality" in in_range.columns else 0
    if old:
        session = _fmt_day(last_session().isoformat())
        if old == len(in_range):
            warnings.append(
                f"None of the options in your range has traded since before {session}, so their prices are old "
                "and may be far from where they open. Check live quotes before selling."
            )
        else:
            warnings.append(
                f"{old} option(s) in your range haven't traded since before {session}. Their prices are old, "
                "so the picks skip them."
            )
    income_pick, balanced_pick, plan_per_contract = pick_for_strategy(recent_prices_only(in_range), config, goal_pace)
    if income_pick is None:
        warnings.append(
            f"Every option in your range expires after earnings or a Fed meeting, and none is near the safe "
            f"end ({config.delta_min:.0%}). Try a shorter expiry window, or wait until after the event."
        )
    scored = in_range

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
        fee_per_contract=fee,
        premium_check=check,
        plan_per_contract=plan_per_contract,
        data_source=source,
    )
