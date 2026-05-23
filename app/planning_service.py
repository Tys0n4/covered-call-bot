# planning_service.py
from __future__ import annotations
import math

from config import ScannerConfig, DEFAULT_CONFIG
from models import ScanResult, PlannedCall
from positions import create_positions_from_plan


def get_allocation_targets(
    total_shares: int,
    open_positions: list[dict],
    config: ScannerConfig,
) -> dict:
    """
    Calculate how many income and balanced contracts are still needed
    to hit the 70/30 target across the TOTAL position, accounting for
    what's already open.

    Returns:
      total_contracts      : total coverable contracts from shares
      open_income          : income contracts already open
      open_balanced        : balanced contracts already open
      needed_income        : income contracts still to sell
      needed_balanced      : balanced contracts still to sell
      available            : total contracts still available to sell
    """
    total = total_shares // 100
    target_income = round(total * config.income_weight)
    target_balanced = total - target_income

    open_income = sum(
        p["contracts"] for p in open_positions
        if p.get("status") == "OPEN" and p.get("allocation_type") == "Income"
    )
    open_balanced = sum(
        p["contracts"] for p in open_positions
        if p.get("status") == "OPEN" and p.get("allocation_type") == "Balanced"
    )

    needed_income   = max(target_income - open_income, 0)
    needed_balanced = max(target_balanced - open_balanced, 0)
    available       = needed_income + needed_balanced

    return {
        "total_contracts":  total,
        "target_income":    target_income,
        "target_balanced":  target_balanced,
        "open_income":      open_income,
        "open_balanced":    open_balanced,
        "needed_income":    needed_income,
        "needed_balanced":  needed_balanced,
        "available":        available,
    }


def build_plan(
    scan: ScanResult,
    config: ScannerConfig = DEFAULT_CONFIG,
    open_positions: list[dict] | None = None,
) -> list[PlannedCall]:
    """
    Build a contract allocation plan that maintains the overall 70/30 split
    across all contracts (open + new), not just the new batch.
    """
    if scan.income_pick is None or scan.balanced_pick is None:
        return []

    position = scan.position
    open_positions = open_positions or []

    targets = get_allocation_targets(position.shares, open_positions, config)

    if targets["available"] == 0:
        print(f"\n  ⚠  No contracts available — all {targets['total_contracts']} are already open.")
        return []

    # Show allocation summary
    print(f"\n  Portfolio allocation summary:")
    print(f"    Total contracts:     {targets['total_contracts']}")
    print(f"    Target income (70%): {targets['target_income']}  |  Open: {targets['open_income']}  |  Still needed: {targets['needed_income']}")
    print(f"    Target balanced (30%): {targets['target_balanced']}  |  Open: {targets['open_balanced']}  |  Still needed: {targets['needed_balanced']}")
    print(f"    Contracts to plan:   {targets['available']}")

    raw_plan = []

    if targets["needed_income"] > 0:
        raw_plan.append({
            "expiry":    scan.income_pick["expiry"],
            "strike":    scan.income_pick["strike"],
            "contracts": targets["needed_income"],
            "type":      "Income",
        })

    if targets["needed_balanced"] > 0:
        raw_plan.append({
            "expiry":    scan.balanced_pick["expiry"],
            "strike":    scan.balanced_pick["strike"],
            "contracts": targets["needed_balanced"],
            "type":      "Balanced",
        })

    return create_positions_from_plan(
        ticker=position.ticker,
        plan=raw_plan,
        scored_calls=scan.candidates,
        config=config,
    )


def compute_buyback_budget(position: PlannedCall, config: ScannerConfig = DEFAULT_CONFIG) -> dict:
    gross     = float(position.premium_total)
    contracts = int(position.contracts)

    buyback_total    = math.ceil(gross * config.buyback_budget_pct)
    per_contract     = buyback_total / contracts if contracts > 0 else 0.0
    limit_per_share  = math.ceil(per_contract / 100.0 * 100) / 100
    net_premium      = gross - buyback_total

    return {
        "buyback_total":   buyback_total,
        "per_contract":    per_contract,
        "limit_per_share": limit_per_share,
        "net_premium":     net_premium,
    }