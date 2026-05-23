# main.py
"""
Usage:
  python main.py          — scan for covered call candidates
  python main.py scan     — same as above
  python main.py manage   — evaluate open positions for buyback
"""

import sys

from config import DEFAULT_CONFIG
from portfolio import load_portfolio
from scanner_service import scan_covered_calls
from planning_service import build_plan
from management_service import run_management, prompt_close_position
from positions_store import load_open_positions, save_positions
from reporting import (
    print_scan_header,
    print_overall_picks,
    print_expiry_breakdown,
    print_allocation_plan,
    print_positions_with_budget,
    print_management_report,
)


def run_scan(config=DEFAULT_CONFIG):
    portfolio = load_portfolio()

    # Load open positions once — used to calculate available contracts
    open_positions = load_open_positions()

    for position in portfolio:
        scan = scan_covered_calls(position, config=config)

        print_scan_header(scan, config=config)

        if scan.candidates.empty:
            print("\n  No covered call candidates found.")
            continue

        print_overall_picks(scan)
        print_expiry_breakdown(scan)

        # Pass open positions so planner knows how many contracts are available
        positions = build_plan(scan, config=config, open_positions=open_positions)

        if not positions:
            continue

        print_allocation_plan(positions, config=config)
        print_positions_with_budget(positions, config=config)

        print("\n  Save these as open positions? (y/n): ", end="")
        answer = input().strip().lower()

        if answer == "y":
            save_positions(positions)
        else:
            print("  Positions not saved.")


def run_manage(config=DEFAULT_CONFIG):
    open_positions = load_open_positions()

    if not open_positions:
        print("\n  No open positions found in data/open_positions.json.")
        print("  Run a scan first and save your positions.")
        return

    results = run_management(config=config)
    print_management_report(results, config=config)
    prompt_close_position(results, open_positions)


def main():
    mode = sys.argv[1].lower() if len(sys.argv) > 1 else "scan"

    if mode == "manage":
        run_manage()
    else:
        run_scan()


if __name__ == "__main__":
    main()