# api/routes/scan.py
import math
from fastapi import APIRouter, Body, HTTPException

from dataclasses import replace

from core.strategy import effective_config, load_strategy
from core.market_hours import next_market_open
from core.portfolio import load_portfolio
from core.scanner import resolve_min_strike, scan_covered_calls
from core.planner import build_plan, compute_buyback_budget, get_allocation_targets
from core.positions import CoverageError, load_open_positions, save_positions
from core.models import PlannedCall
from api.schemas import ScanConfig, ScanResponse, Candidate, AllocationItem, TradeIn, GoalCheck

router = APIRouter(prefix="/scan", tags=["scanner"])


def _num(value):
    """A float, or None for missing/NaN values (NaN isn't valid JSON)."""
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(f) or math.isinf(f) else f


def _row_to_candidate(row) -> Candidate:
    return Candidate(
        expiry=str(row["expiry"]),
        dte=int(row["dte"]),
        strike=float(row["strike"]),
        premium_price=float(row["premium_price"]),
        premium_per_contract=float(row["premium_per_contract"]),
        net_per_contract=float(row.get("net_per_contract", row["premium_per_contract"])),
        annualized_yield_pct=float(row.get("annualized_yield_pct", 0)),
        upside_to_strike_pct=float(row["upside_to_strike_pct"]),
        delta=_num(row.get("delta")),
        spread_pct=_num(row.get("spread_pct")),
        quote_quality=str(row["quote_quality"]),
        last_trade_date=row.get("last_trade_date") if isinstance(row.get("last_trade_date"), str) else None,
        below_cost_basis=bool(row.get("below_cost_basis", False)),
        spans_earnings=bool(row.get("spans_earnings", False)),
        spans_ex_dividend=bool(row.get("spans_ex_dividend", False)),
        spans_fed=bool(row.get("spans_fed", False)),
        spans_industry=bool(row.get("spans_industry", False)),
        monthly_per_contract=_num(row.get("monthly_per_contract")),
    )


# Handlers are plain `def` so FastAPI runs them in a worker thread: a scan
# makes slow network calls that would otherwise freeze every other request.

@router.post("", response_model=ScanResponse)
def run_scan(scan_config: ScanConfig):
    """Run the covered call scanner for one stock in your portfolio."""
    position = next((p for p in load_portfolio() if p.ticker == scan_config.ticker), None)
    if position is None:
        raise HTTPException(
            status_code=404,
            detail=f"{scan_config.ticker} is not in your portfolio. Add it on the Dashboard first.",
        )

    # Your saved strategy (delta range, expiry window, split, buyback) plus the
    # Scanner page's filters; an expiry window sent with the scan overrides the strategy's
    strategy_config = effective_config()
    config = replace(
        strategy_config,
        min_dte=scan_config.min_dte if scan_config.min_dte is not None else strategy_config.min_dte,
        max_dte=scan_config.max_dte if scan_config.max_dte is not None else strategy_config.max_dte,
        min_strike_pct_above_current=scan_config.min_strike_pct,
        min_premium=scan_config.min_premium,
        min_volume=scan_config.min_volume,
        min_open_interest=scan_config.min_open_interest,
        exclude_below_cost=scan_config.exclude_below_cost,
        avoid_earnings=scan_config.avoid_earnings,
    )

    # Goal pace: monthly income each contract you own needs to reach your monthly goal
    holdings = load_portfolio()
    total_contracts = sum(h.total_contracts for h in holdings)
    goal = load_strategy()["monthly_goal"]
    goal_pace = goal / total_contracts if goal > 0 and total_contracts else 0.0

    scan = scan_covered_calls(position, config=config, holdings=[h.ticker for h in holdings], goal_pace=goal_pace)

    if scan.current_price == 0.0:
        raise HTTPException(status_code=503, detail="Could not fetch current price.")

    # Only consider open positions for this ticker
    all_open = load_open_positions()
    ticker_open = [p for p in all_open if p.get("ticker") == position.ticker]

    planned = build_plan(scan, config=config, open_positions=ticker_open)
    targets = get_allocation_targets(position.shares, ticker_open, config)

    min_strike = resolve_min_strike(scan.current_price, config, position.avg_cost)

    candidates = []
    if not scan.candidates.empty:
        for _, row in scan.candidates.iterrows():
            candidates.append(_row_to_candidate(row))

    income_pick  = _row_to_candidate(scan.income_pick)  if scan.income_pick  is not None else None
    balanced_pick= _row_to_candidate(scan.balanced_pick) if scan.balanced_pick is not None else None

    planned_positions = []
    gross_premium = 0.0
    buyback_budget = 0.0

    for p in planned:
        budget = compute_buyback_budget(p, config=config)
        planned_positions.append(AllocationItem(
            allocation_type=p.allocation_type,
            expiry=p.expiry,
            strike=p.strike,
            contracts=p.contracts,
            entry_price=p.entry_price,
            premium_total=p.premium_total,
            quote_quality=p.quote_quality,
            buyback_total=float(budget["buyback_total"]),
            per_contract_budget=float(budget["per_contract"]),
            below_cost_basis=position.avg_cost > 0 and p.strike < position.avg_cost,
        ))
        gross_premium  += p.premium_total
        buyback_budget += budget["buyback_total"]

    est_fees = round(scan.fee_per_contract * sum(p.contracts for p in planned), 2)

    return ScanResponse(
        ticker=position.ticker,
        current_price=scan.current_price,
        avg_cost=position.avg_cost,
        min_strike=min_strike,
        candidates=candidates,
        income_pick=income_pick,
        balanced_pick=balanced_pick,
        allocation_summary=targets,
        planned_positions=planned_positions,
        gross_premium=gross_premium,
        buyback_budget=buyback_budget,
        net_premium=gross_premium - buyback_budget - est_fees,
        estimated_fees=est_fees,
        fee_per_contract=scan.fee_per_contract,
        data_source=scan.data_source,
        premium_check=scan.premium_check,
        delta_min=config.delta_min,
        delta_max=config.delta_max,
        min_dte=config.min_dte,
        max_dte=config.max_dte,
        goal_check=GoalCheck(
            goal=goal, contracts=total_contracts, pace_per_contract=round(goal_pace, 2),
            plan_per_contract=scan.plan_per_contract, met=scan.plan_per_contract >= goal_pace,
        ) if goal_pace > 0 and scan.income_pick is not None else None,
        fed_dates=scan.events.get("fed_dates", []),
        industry_earnings=scan.events.get("industry_earnings", []),
        warnings=scan.warnings,
        quotes_live=scan.quotes_live,
        earnings_date=scan.events.get("earnings_date"),
        ex_dividend_date=scan.events.get("ex_dividend_date"),
        next_market_open=None if scan.quotes_live else next_market_open().isoformat(),
    )


@router.post("/save")
def save_scan_positions(trades: list[TradeIn] = Body(..., min_length=1, max_length=20)):
    """
    Save the recommended trade from a scan as open positions.

    Refused (409) if your shares don't cover it, or if it no longer fits your
    split, e.g. because the same scan was already saved.
    """
    planned = [
        PlannedCall(
            ticker=t.ticker,
            expiry=t.expiry,
            strike=t.strike,
            contracts=t.contracts,
            entry_price=t.entry_price,
            premium_total=t.premium,
            allocation_type=t.allocation_type,
            fees=t.fees,
        )
        for t in trades
    ]
    try:
        save_positions(planned, income_weight=load_strategy()["income_weight"])
    except CoverageError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    return {"saved": len(planned)}
