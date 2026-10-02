# api/routes/scan.py
import math
import sys
from pathlib import Path
from fastapi import APIRouter, HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "app"))

from dataclasses import replace

from strategy import effective_config
from market_hours import next_market_open
from portfolio import load_portfolio
from scanner_service import scan_covered_calls
from planning_service import build_plan, compute_buyback_budget, get_allocation_targets
from positions_store import load_open_positions, save_positions
from models import PlannedCall
from api.schemas import ScanConfig, ScanResponse, Candidate, AllocationItem

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
        annualized_yield_pct=float(row.get("annualized_yield_pct", 0)),
        upside_to_strike_pct=float(row["upside_to_strike_pct"]),
        delta=_num(row.get("delta")),
        spread_pct=_num(row.get("spread_pct")),
        quote_quality=str(row["quote_quality"]),
        income_score=_num(row.get("income_score")),
        balanced_score=_num(row.get("balanced_score")),
    )


@router.post("", response_model=ScanResponse)
async def run_scan(scan_config: ScanConfig):
    """Run the covered call scanner for the specified ticker."""
    portfolio = load_portfolio()

    if not portfolio:
        raise HTTPException(status_code=404, detail="No portfolio positions found.")

    # Find matching ticker — fall back to first position if not specified
    position = next(
        (p for p in portfolio if p.ticker == scan_config.ticker),
        portfolio[0]
    )

    # Filters come from the Scanner page; split and buyback reserve from your saved strategy
    config = replace(
        effective_config(),
        min_dte=scan_config.min_dte,
        max_dte=scan_config.max_dte,
        min_strike_pct_above_current=scan_config.min_strike_pct,
        min_premium=scan_config.min_premium,
        min_volume=scan_config.min_volume,
        min_open_interest=scan_config.min_open_interest,
        target_delta=scan_config.target_delta,
    )

    scan = scan_covered_calls(position, config=config)

    if scan.current_price == 0.0:
        raise HTTPException(status_code=503, detail="Could not fetch current price.")

    # Only consider open positions for this ticker
    all_open = load_open_positions()
    ticker_open = [p for p in all_open if p.get("ticker") == position.ticker]

    planned = build_plan(scan, config=config, open_positions=ticker_open)
    targets = get_allocation_targets(position.shares, ticker_open, config)

    min_strike = scan.current_price * (1 + config.min_strike_pct_above_current)

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
        ))
        gross_premium  += p.premium_total
        buyback_budget += budget["buyback_total"]

    return ScanResponse(
        ticker=position.ticker,
        current_price=scan.current_price,
        min_strike=min_strike,
        candidates=candidates,
        income_pick=income_pick,
        balanced_pick=balanced_pick,
        allocation_summary=targets,
        planned_positions=planned_positions,
        gross_premium=gross_premium,
        buyback_budget=buyback_budget,
        net_premium=gross_premium - buyback_budget,
        warnings=scan.warnings,
        quotes_live=scan.quotes_live,
        next_market_open=None if scan.quotes_live else next_market_open().isoformat(),
    )


@router.post("/save")
async def save_scan_positions(positions_data: list[dict]):
    """Save confirmed positions from a scan to open_positions.json."""
    planned = [
        PlannedCall(
            ticker=p["ticker"],
            expiry=p["expiry"],
            strike=p["strike"],
            contracts=p["contracts"],
            entry_price=p["entry_price"],
            premium_total=p["premium_total"],
            allocation_type=p["allocation_type"],
        )
        for p in positions_data
    ]
    save_positions(planned)
    return {"saved": len(planned)}
