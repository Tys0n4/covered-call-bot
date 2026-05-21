# planning_service.py
"""
Converts a ScanResult into a concrete contract plan and PlannedCall list.
No I/O — pure data transformation.
"""

from __future__ import annotations
import math

from config import ScannerConfig, DEFAULT_CONFIG
from models import ScanResult, PlannedCall
from positions import create_positions_from_plan


def build_plan(
    scan: ScanResult,
    config: ScannerConfig = DEFAULT_CONFIG,
) -> list[PlannedCall]:
    """
    Build a contract allocation plan from the scan result.

    Uses the overall income_pick and balanced_pick directly —
    they may span different expiries, and that is intentional.
    The income pick gets income_weight% of contracts, balanced gets the rest.
    """
    if scan.income_pick is None or scan.balanced_pick is None:
        return []

    position = scan.position
    total_contracts = position.total_contracts
    income_contracts = round(total_contracts * config.income_weight)
    balanced_contracts = total_contracts - income_contracts

    # Build plan items directly from the overall best picks.
    # Expiries may differ between income and balanced — that's fine.
    raw_plan = [
        {
            "expiry": scan.income_pick["expiry"],
            "strike": scan.income_pick["strike"],
            "contracts": income_contracts,
            "type": "Income",
        },
        {
            "expiry": scan.balanced_pick["expiry"],
            "strike": scan.balanced_pick["strike"],
            "contracts": balanced_contracts,
            "type": "Balanced",
        },
    ]

    return create_positions_from_plan(
        ticker=position.ticker,
        plan=raw_plan,
        scored_calls=scan.candidates,
        config=config,
    )


def compute_buyback_budget(position: PlannedCall, config: ScannerConfig = DEFAULT_CONFIG) -> dict:
    gross = float(position.premium_total)
    contracts = int(position.contracts)

    buyback_total = math.ceil(gross * config.buyback_budget_pct)
    per_contract = buyback_total / contracts if contracts > 0 else 0.0
    limit_per_share = math.ceil(per_contract / 100.0 * 100) / 100
    net_premium = gross - buyback_total

    return {
        "buyback_total": buyback_total,
        "per_contract": per_contract,
        "limit_per_share": limit_per_share,
        "net_premium": net_premium,
    }
