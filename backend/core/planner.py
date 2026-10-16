# planner.py
"""
Turns a scan into the trade to place: every contract your shares can still
cover, on the recommended call (the scan's income pick). The scan's other pick
(near the safe end of your range) is offered as an alternative for the same
contracts when it's a different call.
"""
from __future__ import annotations
import logging

import pandas as pd

from core.config import ScannerConfig, DEFAULT_CONFIG
from core.models import ScanResult, PlannedCall

log = logging.getLogger(__name__)


def _find_option_row(
    scored_calls: pd.DataFrame,
    expiry: str,
    strike: float,
    tolerance: float,
) -> pd.Series:
    """
    Match a row by expiry and strike using tolerance instead of exact equality.
    Raises ValueError if no match is within tolerance.
    """
    expiry_df = scored_calls[scored_calls["expiry"] == expiry]
    if expiry_df.empty:
        raise ValueError(f"No options found for expiry {expiry!r}")

    diffs = (expiry_df["strike"] - strike).abs()
    closest_idx = diffs.idxmin()
    if diffs[closest_idx] > tolerance:
        raise ValueError(
            f"No option within ${tolerance:.2f} of strike {strike} for expiry {expiry!r}. "
            f"Closest was {expiry_df.loc[closest_idx, 'strike']:.2f}."
        )
    return expiry_df.loc[closest_idx]


def create_position(
    ticker: str,
    expiry: str,
    strike: float,
    contracts: int,
    entry_price: float,
    premium_source: str = "NONE",
    quote_quality: str = "BAD",
    warning: str = "Verify on broker",
    allocation_type: str = "",
) -> PlannedCall:
    return PlannedCall(
        ticker=ticker,
        expiry=expiry,
        strike=strike,
        contracts=contracts,
        entry_price=entry_price,
        premium_total=round(contracts * entry_price * 100, 2),
        premium_source=premium_source,
        quote_quality=quote_quality,
        warning=warning,
        status="OPEN",
        allocation_type=allocation_type,
    )


def free_contracts(total_shares: int, open_positions: list[dict]) -> int:
    """Contracts the shares can still cover: one per 100 shares, minus calls already open."""
    open_total = sum(int(p["contracts"]) for p in open_positions if p.get("status", "OPEN") == "OPEN")
    return max(int(total_shares) // 100 - open_total, 0)


def _plan_on(scan: ScanResult, pick, contracts: int, kind: str, config: ScannerConfig) -> list[PlannedCall]:
    row = _find_option_row(scan.candidates, expiry=pick["expiry"], strike=float(pick["strike"]),
                           tolerance=config.strike_match_tolerance)
    return [create_position(
        ticker=scan.position.ticker,
        expiry=pick["expiry"],
        strike=float(row["strike"]),
        contracts=contracts,
        entry_price=float(row["premium_price"]),
        premium_source=str(row.get("premium_source", "NONE")),
        quote_quality=str(row.get("quote_quality", "BAD")),
        warning=str(row.get("warning", "Verify on broker")),
        allocation_type=kind,
    )]


def build_plan(
    scan: ScanResult,
    config: ScannerConfig = DEFAULT_CONFIG,
    open_positions: list[dict] | None = None,
) -> list[PlannedCall]:
    """The trade to place: every free contract on the recommended call. Empty without a pick or free contracts."""
    if scan.income_pick is None:
        return []
    free = free_contracts(scan.position.shares, open_positions or [])
    if free == 0:
        log.info("%s: no contracts available, every one has a call sold", scan.position.ticker)
        return []
    return _plan_on(scan, scan.income_pick, free, "Income", config)


def alternative_plan(
    scan: ScanResult,
    config: ScannerConfig = DEFAULT_CONFIG,
    open_positions: list[dict] | None = None,
) -> list[PlannedCall]:
    """The same contracts on the scan's other pick (more room for the stock to rise), when it's a different call."""
    inc, bal = scan.income_pick, scan.balanced_pick
    if inc is None or bal is None:
        return []
    if str(inc["expiry"]) == str(bal["expiry"]) and abs(float(inc["strike"]) - float(bal["strike"])) <= config.strike_match_tolerance:
        return []
    free = free_contracts(scan.position.shares, open_positions or [])
    return _plan_on(scan, bal, free, "Balanced", config) if free else []
