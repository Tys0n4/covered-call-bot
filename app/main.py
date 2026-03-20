from portfolio import load_portfolio
from market_data import get_current_price
from options_data import get_call_options_in_dte_range
from filters import filter_covered_calls
from calculations import add_option_metrics
from greeks import add_estimated_delta
from scoring import score_options, pick_best_options
from planner import allocate_manual
from positions import create_positions_from_plan
# from management import evaluate_position

def print_section_header(title):
    print("\n" + "=" * 60)
    print(title)
    print("=" * 60)


def print_pick(label, option, include_expiry=False):
    if option is None:
        return

    expiry_text = f"Expiry: {option['expiry']} | " if include_expiry else ""

    print(
        f"{label:<8} -> {expiry_text}"
        f"Strike: {option['strike']:.1f} | "
        f"Premium: ${option['premium_price']:.2f} | "
        f"Delta: {option['delta']:.3f} | "
        f"Upside: {option['upside_to_strike_pct']:.2f}%"
    )


def print_overall_summary(income, balanced, safe):
    expiries = [income["expiry"], balanced["expiry"], safe["expiry"]]
    counts = {}

    for expiry in expiries:
        counts[expiry] = counts.get(expiry, 0) + 1

    best_expiry = max(counts, key=counts.get)
    best_count = counts[best_expiry]

    print("\nSummary Recommendation:\n")

    if best_count >= 2:
        print(f"Suggested focus: {best_expiry} looks strongest overall.")
    else:
        print("Suggested focus: no single expiry dominates, so choose based on your priority.")


def print_overall_picks(scored_calls):
    overall_income, overall_balanced, overall_safe = pick_best_options(scored_calls)

    print("\nOverall Best Picks:\n")
    print_pick("Income", overall_income, include_expiry=True)
    print_pick("Balanced", overall_balanced, include_expiry=True)
    print_pick("Safe", overall_safe, include_expiry=True)

    print_overall_summary(overall_income, overall_balanced, overall_safe)


def print_expiry_table(group):
    display_df = group[
        [
            "strike",
            "delta",
            "premium_price",
            "premium_per_contract",
            "premium_yield_pct",
            "upside_to_strike_pct",
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
        }
    )

    print(display_df.to_string(index=False))


def print_expiry_section(expiry, group):
    group = group.sort_values(by="strike")
    dte = int(group["dte"].iloc[0])

    print_section_header(f"Expiry: {expiry} | DTE: {dte}")

    if len(group) == 1:
        one = group.iloc[0]
        print("Only 1 valid candidate for this expiry.\n")
        print_pick("Candidate", one)
        print()
    else:
        income, balanced, safe = pick_best_options(group)

        print("Best Picks:\n")
        print_pick("Income", income)
        print_pick("Balanced", balanced)
        print_pick("Safe", safe)
        print()

    print_expiry_table(group)


def main():
    portfolio = load_portfolio()

    stock = portfolio[0]
    ticker = stock["ticker"]
    shares = stock["shares"]
    avg_cost = stock["avg_cost"]
    min_sale_price = stock["min_sale_price"]

    current_price = get_current_price(ticker)
    calls = get_call_options_in_dte_range(ticker, min_dte=24, max_dte=38)

    filtered_calls = filter_covered_calls(
        calls,
        min_sale_price,
        current_price,
        min_premium=0.10,
        min_volume=10,
        max_strike_multiple=1.50
    )

    filtered_calls = add_estimated_delta(filtered_calls, current_price)
    scored_calls = add_option_metrics(filtered_calls, current_price)
    scored_calls = score_options(scored_calls)

    print_section_header(f"{ticker} Covered Call Scanner")
    print(f"Shares: {shares}")
    print(f"Average Cost: ${avg_cost:.2f}")
    print(f"Current Price: ${current_price:.2f}")
    print(f"Minimum Sale Price: ${min_sale_price:.2f}")
    print("Expiry Window: 24 to 38 DTE")

    if scored_calls.empty:
        print("\nNo covered call candidates found.")
        return
    overall_income, overall_balanced, overall_safe = pick_best_options(scored_calls)

    print_overall_picks(scored_calls)

    grouped = scored_calls.sort_values(by=["expiry", "strike"])
    for expiry, group in grouped.groupby("expiry"):
        print_expiry_section(expiry, group)

    # Planner
    print_section_header("Planned Covered Call Allocations")

    selected_expiry = overall_balanced["expiry"]

    expiry_group = scored_calls[scored_calls["expiry"] == selected_expiry]

    income_in_expiry, balanced_in_expiry, _ = pick_best_options(expiry_group)

    plan = allocate_manual(
    total_shares=shares,
    expiry=selected_expiry,
    allocations=[
        {"strike": income_in_expiry["strike"], "contracts": 7},
        {"strike": balanced_in_expiry["strike"], "contracts": 10}
    ]
)

    for item in plan:
        print(
            f"Sell {item['contracts']} contracts | "
            f"Expiry: {item['expiry']} | "
            f"Strike: {item['strike']}"
        )


if __name__ == "__main__":
    main()