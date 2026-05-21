# reporting.py
from __future__ import annotations
import pandas as pd

from models import ScanResult, PlannedCall
from config import ScannerConfig, DEFAULT_CONFIG

_DISPLAY_COLS = {
    "strike":               "Strike",
    "delta":                "Delta",
    "premium_price":        "Premium",
    "premium_per_contract": "$/Contract",
    "annualized_yield_pct": "Ann.Yield%",
    "upside_to_strike_pct": "Upside%",
    "spread_pct":           "Spread%",
    "quote_quality":        "Quote",
}


def _section(title: str) -> None:
    print(f"\n{'─' * 60}")
    print(f"  {title}")
    print(f"{'─' * 60}")


def _fmt_pick(label: str, opt, *, include_expiry: bool = False) -> str:
    if opt is None:
        return f"{label:<10} -> (none)"

    delta_val = opt.get("delta")
    delta_str = f"{delta_val:.3f}" if delta_val is not None and not pd.isna(delta_val) else "n/a"
    ann_yield = opt.get("annualized_yield_pct")
    yield_str = f"{ann_yield:.1f}%" if ann_yield is not None and not pd.isna(ann_yield) else "n/a"
    expiry_part = f"Expiry: {opt['expiry']} | " if include_expiry else ""

    return (
        f"{label:<10} -> {expiry_part}"
        f"Strike: {opt['strike']:.2f} | "
        f"Premium: ${opt['premium_price']:.2f} | "
        f"Delta: {delta_str} | "
        f"Ann.Yield: {yield_str} | "
        f"Upside: {opt['upside_to_strike_pct']:.2f}%"
    )


def print_scan_header(scan: ScanResult, config: ScannerConfig = DEFAULT_CONFIG) -> None:
    pos = scan.position
    pct = int(config.min_strike_pct_above_current * 100)
    min_strike = scan.current_price * (1.0 + config.min_strike_pct_above_current)

    _section(f"{pos.ticker} Covered Call Scanner")
    print(f"  Shares:           {pos.shares}")
    print(f"  Average Cost:     ${pos.avg_cost:.2f}")
    print(f"  Current Price:    ${scan.current_price:.2f}")
    print(f"  Min Strike Used:  ${min_strike:.2f}  (+{pct}% above current price)")
    print(f"  DTE Window:       {config.min_dte} to {config.max_dte}")

    if scan.warnings:
        print()
        for w in scan.warnings:
            print(f"  ⚠  {w}")


def print_overall_picks(scan: ScanResult) -> None:
    _section("Overall Best Picks")
    print(_fmt_pick("Income", scan.income_pick, include_expiry=True))
    print(_fmt_pick("Balanced", scan.balanced_pick, include_expiry=True))


def print_expiry_breakdown(scan: ScanResult) -> None:
    _section("Candidates by Expiry")

    df = scan.candidates.sort_values(by=["expiry", "strike"])

    for expiry, group in df.groupby("expiry"):
        dte = int(group["dte"].iloc[0])
        print(f"\n  Expiry: {expiry}  |  DTE: {dte}")

        from scoring import pick_best_options
        income, balanced = pick_best_options(group)

        if len(group) == 1:
            print("  " + _fmt_pick("Candidate", group.iloc[0]))
        else:
            print("  " + _fmt_pick("Income", income))
            print("  " + _fmt_pick("Balanced", balanced))

        present = {k: v for k, v in _DISPLAY_COLS.items() if k in group.columns}
        tbl = group[list(present.keys())].rename(columns=present)
        print()
        print(tbl.to_string(index=False))


def print_allocation_plan(
    positions: list[PlannedCall],
    config: ScannerConfig = DEFAULT_CONFIG,
) -> None:
    _section("Planned Covered Call Allocations")
    total_contracts = sum(p.contracts for p in positions)
    for p in positions:
        pct = round(p.contracts / total_contracts * 100) if total_contracts else 0
        label = f"[{p.allocation_type}]" if p.allocation_type else ""
        print(
            f"  {label:<12} Sell {p.contracts} contracts ({pct}%) | "
            f"Expiry: {p.expiry} | "
            f"Strike: {p.strike:.2f} | "
            f"Entry: ${p.entry_price:.2f} | "
            f"Quote: {p.quote_quality}"
        )
        if p.warning:
            print(f"    ⚠  {p.warning}")


def print_positions_with_budget(
    positions: list[PlannedCall],
    config: ScannerConfig = DEFAULT_CONFIG,
) -> None:
    from planning_service import compute_buyback_budget

    _section("Planned Open Positions & Buyback Budget")

    gross_premium = 0.0
    total_buyback = 0.0

    for p in positions:
        budget = compute_buyback_budget(p, config=config)
        label = f"[{p.allocation_type}]" if p.allocation_type else ""
        print(
            f"  {label:<12} {p.ticker} | "
            f"Sell {p.contracts} contracts | "
            f"Expiry: {p.expiry} | "
            f"Strike: {p.strike:.2f} | "
            f"Entry: ${p.entry_price:.2f} | "
            f"Gross: ${p.premium_total:.2f}"
        )
        print(
            f"    Buyback budget: ${budget['buyback_total']:.0f} total | "
            f"${budget['per_contract']:.2f}/contract | "
            f"${budget['limit_per_share']:.2f}/share"
        )
        print()

        gross_premium += p.premium_total
        total_buyback += budget["buyback_total"]

    net = gross_premium - total_buyback
    kept_pct = int((1 - config.buyback_budget_pct) * 100)
    print(f"  Gross Premium Collected:          ${gross_premium:.2f}")
    print(f"  Buyback Budget ({kept_pct}% kept):  -${total_buyback:.2f}")
    print(f"  Net Premium After Buyback:         ${net:.2f}")
