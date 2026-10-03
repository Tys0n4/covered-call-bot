# planning_service.py
from __future__ import annotations
import logging
import math

from config import ScannerConfig, DEFAULT_CONFIG
from models import ScanResult, PlannedCall
from positions import create_positions_from_plan
from strategy import allocation_targets

log = logging.getLogger(__name__)


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
    open_income = sum(
        p["contracts"] for p in open_positions
        if p.get("status") == "OPEN" and p.get("allocation_type") == "Income"
    )
    open_balanced = sum(
        p["contracts"] for p in open_positions
        if p.get("status") == "OPEN" and p.get("allocation_type") == "Balanced"
    )
    return allocation_targets(total_shares // 100, open_income, open_balanced, config.income_weight)


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
        log.info("%s: no contracts available, all %d are already open", position.ticker, targets["total_contracts"])
        return []

    log.info(
        "%s plan: %d contracts, income %d (open %d, need %d), balanced %d (open %d, need %d)",
        position.ticker, targets["total_contracts"],
        targets["target_income"], targets["open_income"], targets["needed_income"],
        targets["target_balanced"], targets["open_balanced"], targets["needed_balanced"],
    )

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