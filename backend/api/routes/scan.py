# api/routes/scan.py
import logging
import math
from fastapi import APIRouter, Body, Depends, HTTPException

from dataclasses import replace

from core.config import ScannerConfig
from core.strategy import effective_config, load_strategy
from core.market_hours import next_market_open, quotes_live_at
from core.models import PlannedCall, PortfolioPosition
from core.parallel import parallel_map
from core.portfolio import load_portfolio
from core.scanner import resolve_min_strike, scan_covered_calls
from core.planner import alternative_plan, build_plan, free_contracts
from core.positions import CoverageError, load_open_positions, save_positions
from api.auth import current_user
from api import limits
from api.schemas import (
    AllocationItem, Candidate, GoalCheck, ScanAllItem, ScanAllResponse, ScanConfig, ScanFilters, ScanResponse, TradeIn,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/scan", tags=["scanner"])


def _num(value):
    """A float, or None for missing/NaN values (NaN isn't valid JSON)."""
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(f) or math.isinf(f) else f


def _price_basis(row) -> str | None:
    """How a non-live option is priced: the last session's closing quote, or its last trade."""
    if str(row.get("quote_quality")) != "STALE":
        return None
    return "last_trade" if row.get("premium_source") == "LAST" else "closing"


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
        price_basis=_price_basis(row),
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

def _config(user_id: int, filters: ScanFilters) -> ScannerConfig:
    """
    Your saved strategy (delta range, expiry window, split, buyback) plus the
    Scanner page's filters; an expiry window sent with the scan overrides the strategy's.
    """
    strategy_config = effective_config(user_id)
    return replace(
        strategy_config,
        min_dte=filters.min_dte if filters.min_dte is not None else strategy_config.min_dte,
        max_dte=filters.max_dte if filters.max_dte is not None else strategy_config.max_dte,
        min_strike_pct_above_current=filters.min_strike_pct,
        min_premium=filters.min_premium,
        min_volume=filters.min_volume,
        min_open_interest=filters.min_open_interest,
        exclude_below_cost=filters.exclude_below_cost,
        avoid_earnings=filters.avoid_earnings,
    )


@router.post("", response_model=ScanResponse)
def run_scan(scan_config: ScanConfig, user_id: int = Depends(current_user)):
    """Run the covered call scanner for one stock in your portfolio."""
    limits.SCANS.take(user_id)
    holdings = load_portfolio(user_id)
    position = next((p for p in holdings if p.ticker == scan_config.ticker), None)
    if position is None:
        raise HTTPException(
            status_code=404,
            detail=f"{scan_config.ticker} is not in your portfolio. Add it on the Dashboard first.",
        )
    return _scan_one(position, _config(user_id, scan_config), holdings, load_strategy(user_id)["monthly_goal"],
                     load_open_positions(user_id))


@router.post("/all", response_model=ScanAllResponse)
def scan_all(filters: ScanFilters, user_id: int = Depends(current_user)):
    """
    Scan every stock that has contracts free to sell, with the same rules and
    filters as scanning each one alone. A few stocks are scanned at a time; a
    stock that fails says why instead of failing the rest.
    """
    limits.SCAN_ALLS.take(user_id)
    holdings = load_portfolio(user_id)
    config = _config(user_id, filters)
    goal = load_strategy(user_id)["monthly_goal"]
    all_open = load_open_positions(user_id)
    free, covered = [], []
    for h in holdings:
        ticker_open = [p for p in all_open if p.get("ticker") == h.ticker]
        available = free_contracts(h.shares, ticker_open)
        if available > 0:
            free.append((h, available))
        elif h.total_contracts > 0:
            covered.append(h.ticker)

    def scan(item: tuple[PortfolioPosition, int]) -> ScanAllItem:
        holding, available = item
        try:
            result = _scan_one(holding, config, holdings, goal, all_open)
            return ScanAllItem(ticker=holding.ticker, available=available, result=result)
        except HTTPException as e:
            return ScanAllItem(ticker=holding.ticker, available=available, error=str(e.detail))
        except Exception:
            log.exception("Scanning %s failed", holding.ticker)
            return ScanAllItem(ticker=holding.ticker, available=available,
                               error=f"Couldn't scan {holding.ticker} right now. Try again in a minute.")

    scanned = parallel_map(scan, free, max_workers=4)
    scanned.sort(key=lambda i: -(i.result.gross_premium if i.result and i.result.planned_positions else -1.0))
    return ScanAllResponse(scanned=scanned, covered=covered)


def _scan_one(
    position: PortfolioPosition,
    config: ScannerConfig,
    holdings: list[PortfolioPosition],
    goal: float,
    all_open: list[dict],
) -> ScanResponse:
    """One stock's scan and the trade to place, for /scan and /scan/all. 503 when there's no stock price."""
    # Goal pace: monthly income each contract you own needs to reach your monthly goal
    total_contracts = sum(h.total_contracts for h in holdings)
    goal_pace = goal / total_contracts if goal > 0 and total_contracts else 0.0

    scan = scan_covered_calls(position, config=config, holdings=[h.ticker for h in holdings], goal_pace=goal_pace)

    if scan.current_price == 0.0:
        raise HTTPException(status_code=503, detail=f"Could not fetch {position.ticker}'s current price.")

    # Only consider open positions for this ticker
    ticker_open = [p for p in all_open if p.get("ticker") == position.ticker]

    planned = build_plan(scan, config=config, open_positions=ticker_open)
    other = alternative_plan(scan, config=config, open_positions=ticker_open)
    free = free_contracts(position.shares, ticker_open)

    min_strike = resolve_min_strike(scan.current_price, config, position.avg_cost)

    candidates = []
    if not scan.candidates.empty:
        for _, row in scan.candidates.iterrows():
            candidates.append(_row_to_candidate(row))

    income_pick  = _row_to_candidate(scan.income_pick)  if scan.income_pick  is not None else None
    balanced_pick= _row_to_candidate(scan.balanced_pick) if scan.balanced_pick is not None else None

    def item(p) -> AllocationItem:
        return AllocationItem(
            allocation_type=p.allocation_type,
            expiry=p.expiry,
            strike=p.strike,
            contracts=p.contracts,
            entry_price=p.entry_price,
            premium_total=p.premium_total,
            quote_quality=p.quote_quality,
            below_cost_basis=position.avg_cost > 0 and p.strike < position.avg_cost,
        )

    planned_positions = [item(p) for p in planned]
    gross_premium = sum(p.premium_total for p in planned)
    est_fees = round(scan.fee_per_contract * sum(p.contracts for p in planned), 2)

    return ScanResponse(
        ticker=position.ticker,
        current_price=scan.current_price,
        avg_cost=position.avg_cost,
        min_strike=min_strike,
        candidates=candidates,
        income_pick=income_pick,
        balanced_pick=balanced_pick,
        allocation_summary={"total_contracts": position.total_contracts, "available": free},
        planned_positions=planned_positions,
        alternative=item(other[0]) if other else None,
        gross_premium=gross_premium,
        estimated_fees=est_fees,
        fee_per_contract=scan.fee_per_contract,
        data_source=scan.data_source,
        price_source=scan.price_source,
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
        event_notes=scan.event_notes,
        quotes_live=scan.quotes_live,
        earnings_date=scan.events.get("earnings_date"),
        ex_dividend_date=scan.events.get("ex_dividend_date"),
        next_market_open=None if scan.quotes_live else next_market_open().isoformat(),
        quotes_live_at=_iso(quotes_live_at()),
    )


@router.post("/save")
def save_scan_positions(trades: list[TradeIn] = Body(..., min_length=1, max_length=20), user_id: int = Depends(current_user)):
    """
    Save the trade from a scan (what your broker filled) as open positions.

    Refused (409) if your shares don't cover it, e.g. because the same scan
    was already saved.
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
        save_positions(user_id, planned)
    except CoverageError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    return {"saved": len(planned)}


def _iso(when) -> str | None:
    return when.isoformat() if when else None
