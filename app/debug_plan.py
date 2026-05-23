# debug_plan.py — drop in app/ folder, run once, then delete
from positions_store import load_open_positions
from planning_service import get_allocation_targets
from config import DEFAULT_CONFIG

open_positions = load_open_positions()
print(f"Positions loaded: {len(open_positions)}")
for p in open_positions:
    print(f"  {p.get('allocation_type')} | contracts={p.get('contracts')} | status={p.get('status')}")

targets = get_allocation_targets(total_shares=1822, open_positions=open_positions, config=DEFAULT_CONFIG)
print(f"\nAllocation targets: {targets}")