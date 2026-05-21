# debug_scan.py - drop this in your app/ folder and run it once to see raw data
# Delete it after debugging.

from options_data import get_call_options_in_dte_range
from market_data import get_current_price

ticker = "SOFI"
current_price = get_current_price(ticker)
print(f"Current price: ${current_price:.2f}")
print(f"Min strike at +25%: ${current_price * 1.25:.2f}")
print(f"Portfolio floor: $21.00")
print()

calls = get_call_options_in_dte_range(ticker, min_dte=20, max_dte=50)

if calls.empty:
    print("No options returned at all from yfinance.")
else:
    print(f"Total calls fetched: {len(calls)}")
    print(f"Expiries found: {sorted(calls['expiry'].unique())}")
    print(f"Strike range: ${calls['strike'].min():.2f} to ${calls['strike'].max():.2f}")
    print(f"DTE range: {calls['dte'].min()} to {calls['dte'].max()}")
    print()
    print("All strikes at or above $21.00:")
    above = calls[calls["strike"] >= 21.00][["expiry", "dte", "strike", "bid", "ask", "lastPrice", "volume"]].sort_values(["expiry", "strike"])
    print(above.to_string(index=False) if not above.empty else "  None found.")