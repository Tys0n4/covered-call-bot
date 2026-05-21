# main.py
"""
Entrypoint — coordinates execution only.
All strategy logic lives in scanner_service / planning_service.
All output formatting lives in reporting.
"""

from config import DEFAULT_CONFIG
from portfolio import load_portfolio
from scanner_service import scan_covered_calls
from planning_service import build_plan
from reporting import (
    print_scan_header,
    print_overall_picks,
    print_expiry_breakdown,
    print_allocation_plan,
    print_positions_with_budget,
)


def main(config=DEFAULT_CONFIG):
    portfolio = load_portfolio()

    for position in portfolio:
        scan = scan_covered_calls(position, config=config)

        print_scan_header(scan, config=config)

        if scan.candidates.empty:
            print("\n  No covered call candidates found.")
            continue

        print_overall_picks(scan)
        print_expiry_breakdown(scan)

        positions = build_plan(scan, config=config)

        if not positions:
            print("\n  Could not build allocation plan.")
            continue

        print_allocation_plan(positions, config=config)
        print_positions_with_budget(positions, config=config)


if __name__ == "__main__":
    main()
