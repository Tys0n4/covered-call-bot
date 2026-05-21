# positions.py
from __future__ import annotations
import pandas as pd

from models import PlannedCall
from config import ScannerConfig, DEFAULT_CONFIG


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
    expiry_mask = scored_calls["expiry"] == expiry
    expiry_df = scored_calls[expiry_mask]

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


def create_positions_from_plan(
    ticker: str,
    plan: list[dict],
    scored_calls: pd.DataFrame,
    config: ScannerConfig = DEFAULT_CONFIG,
) -> list[PlannedCall]:
    positions: list[PlannedCall] = []

    for item in plan:
        row = _find_option_row(
            scored_calls,
            expiry=item["expiry"],
            strike=float(item["strike"]),
            tolerance=config.strike_match_tolerance,
        )

        positions.append(
            create_position(
                ticker=ticker,
                expiry=item["expiry"],
                strike=float(row["strike"]),
                contracts=item["contracts"],
                entry_price=float(row["premium_price"]),
                premium_source=str(row.get("premium_source", "NONE")),
                quote_quality=str(row.get("quote_quality", "BAD")),
                warning=str(row.get("warning", "Verify on broker")),
                allocation_type=item.get("type", ""),
            )
        )

    return positions
