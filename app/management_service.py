# management_service.py
"""
Orchestrates the management workflow:
  1. Load open positions from store
  2. Evaluate each for buyback conditions
  3. Return results for reporting
"""

from __future__ import annotations

from config import ScannerConfig, DEFAULT_CONFIG
from positions_store import load_open_positions, close_position
from management import evaluate_positions
from models import OpenCoveredCall


def run_management(
    config: ScannerConfig = DEFAULT_CONFIG,
) -> list[OpenCoveredCall]:
    """
    Load all open positions and evaluate buyback conditions.
    Returns evaluated positions sorted by profit capture descending.
    """
    open_positions = load_open_positions()

    if not open_positions:
        return []

    print(f"\n  Evaluating {len(open_positions)} open position(s)...\n")

    results = evaluate_positions(open_positions, config=config)

    # Sort: buyback candidates first, then by profit capture descending
    results.sort(key=lambda r: (not r.should_buy_back, -r.profit_capture_pct))

    return results


def prompt_close_position(results: list[OpenCoveredCall], open_positions: list[dict]) -> None:
    """
    Interactively ask the user if they want to mark any positions as closed.
    Matches by ticker + expiry + strike.
    """
    buyback_candidates = [r for r in results if r.should_buy_back]

    if not buyback_candidates:
        return

    print("\n  Mark positions as closed? Enter position ID(s) separated by commas, or press Enter to skip:")

    # Show IDs for buyback candidates
    for pos in open_positions:
        for r in buyback_candidates:
            if (
                pos["ticker"] == r.ticker and
                pos["expiry"] == r.expiry and
                abs(pos["strike"] - r.strike) < 0.01
            ):
                print(f"    ID {pos['id']} — {r.ticker} {r.expiry} ${r.strike:.2f}")

    raw = input("  > ").strip()

    if not raw:
        return

    try:
        ids = [int(x.strip()) for x in raw.split(",")]
    except ValueError:
        print("  Invalid input — no positions closed.")
        return

    for pid in ids:
        if close_position(pid):
            print(f"  ✓ Position {pid} marked as CLOSED.")
        else:
            print(f"  ✗ Position {pid} not found.")
