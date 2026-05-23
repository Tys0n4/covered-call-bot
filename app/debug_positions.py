# debug_positions.py — drop in app/ folder, run once, then delete
from pathlib import Path
import json

BASE_DIR = Path(__file__).resolve().parent
POSITIONS_FILE = BASE_DIR / "data" / "open_positions.json"

print(f"Looking for positions file at: {POSITIONS_FILE}")
print(f"File exists: {POSITIONS_FILE.exists()}")

if POSITIONS_FILE.exists():
    with open(POSITIONS_FILE, "r") as f:
        data = json.load(f)
    print(f"Positions found: {len(data)}")
    for p in data:
        print(f"  ID {p.get('id')} | {p.get('ticker')} | status={p.get('status')} | type={p.get('allocation_type')} | contracts={p.get('contracts')}")
else:
    print("File not found — check the path above matches where your open_positions.json actually is.")