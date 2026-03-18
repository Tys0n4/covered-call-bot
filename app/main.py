from portfolio import load_portfolio
from market_data import get_current_price
from options_data import get_call_options_in_dte_range
from filters import filter_covered_calls
from calculations import add_option_metrics
from greeks import add_estimated_delta


def print_section_header(title):
    print("\n" + "=" * 60)
    print(title)
    print("=" * 60)


portfolio = load_portfolio()

stock = portfolio[0]
ticker = stock["ticker"]
shares = stock["shares"]
avg_cost = stock["avg_cost"]
min_sale_price = stock["min_sale_price"]

current_price = get_current_price(ticker)
calls = get_call_options_in_dte_range(ticker, min_dte=24, max_dte=38)

print_section_header(f"{ticker} Covered Call Scanner")
print(f"Shares: {shares}")
print(f"Average Cost: ${avg_cost:.2f}")
print(f"Current Price: ${current_price:.2f}")
print(f"Minimum Sale Price: ${min_sale_price:.2f}")
print("Expiry Window: 24 to 38 DTE")

filtered_calls = filter_covered_calls(
    calls,
    min_sale_price,
    current_price,
    min_premium=0.05,
    min_volume=10,
    max_strike_multiple=1.50
)

filtered_calls = add_estimated_delta(filtered_calls, current_price)

scored_calls = add_option_metrics(filtered_calls, current_price)

if scored_calls.empty:
    print("\nNo covered call candidates found.")
else:
    grouped = scored_calls.sort_values(by=["expiry", "strike"])

    for expiry, group in grouped.groupby("expiry"):
        group = group.sort_values(by="strike")
        dte = int(group["dte"].iloc[0])

        print_section_header(f"Expiry: {expiry} | DTE: {dte}")

        display_df = group[
            [
                "strike",
                "delta",
                "premium_price",
                "premium_per_contract",
                "premium_yield_pct",
                "upside_to_strike_pct",
                "volume",
            ]
        ].copy()

        display_df = display_df.rename(
            columns={
                "strike": "Strike",
                "delta": "Delta",
                "premium_price": "Premium",
                "premium_per_contract": "$/Contract",
                "premium_yield_pct": "Yield %",
                "upside_to_strike_pct": "Upside %",
                "volume": "Volume",
            }
        )

        print(display_df.to_string(index=False))