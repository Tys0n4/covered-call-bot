# main.py
from portfolio import load_portfolio
from market_data import get_current_price
from options_data import get_call_options_in_dte_range
from filters import filter_covered_calls
from calculations import add_option_metrics
from greeks import add_estimated_delta
from scoring import score_options, pick_best_options
from planner import allocate_manual, get_total_contracts
from positions import create_positions_from_plan
import math


def print_section_header(title):
    print(f"\n{title}")


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


def print_overall_summary(income, balanced):
    expiries = [income["expiry"], balanced["expiry"]]
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
    overall_income, overall_balanced = pick_best_options(scored_calls)

    print("\nOverall Best Picks:\n")
    print_pick("Income", overall_income, include_expiry=True)
    print_pick("Balanced", overall_balanced, include_expiry=True)


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
        print_pick("Candidate", one)
        print()
    else:
        income, balanced = pick_best_options(group)
        print_pick("Income", income)
        print_pick("Balanced", balanced)
        print()


def main():
    portfolio = load_portfolio()

    stock = portfolio[0]
    ticker = stock["ticker"]
    shares = stock["shares"]
    avg_cost = stock["avg_cost"]

    current_price = get_current_price(ticker)
    if current_price is None:
        print(f"\nCould not fetch current price for {ticker}.")
        return

    calls = get_call_options_in_dte_range(ticker, min_dte=24, max_dte=38)

    # Min strike = +25% from current market
    min_sale_price_pct = 0.25
    min_strike_price = current_price * (1 + min_sale_price_pct)

    filtered_calls = filter_covered_calls(
        calls,
        min_strike_price,
        current_price,
        min_premium=0.10,
        min_volume=10,
        max_strike_multiple=1.40
    )

    filtered_calls = add_estimated_delta(filtered_calls, current_price)
    scored_calls = add_option_metrics(filtered_calls, current_price)
    scored_calls = score_options(scored_calls)

    print_section_header(f"{ticker} Covered Call Scanner")
    print(f"Shares: {shares}")
    print(f"Average Cost: ${avg_cost:.2f}")
    print(f"Current Price: ${current_price:.2f}")
    print(f"Minimum Sale Price: ${min_strike_price:.2f} (+{int(min_sale_price_pct * 100)}%)")
    print("Expiry Window: 24 to 38 DTE")

    if scored_calls.empty:
        print("\nNo covered call candidates found.")
        return

    overall_income, overall_balanced = pick_best_options(scored_calls)

    print_overall_picks(scored_calls)

    grouped = scored_calls.sort_values(by=["expiry", "strike"])
    for expiry, group in grouped.groupby("expiry"):
        print_expiry_section(expiry, group)

    # Planned positions: 40/60 split (Income/Balanced)
    print_section_header("Planned Covered Call Allocations")

    selected_expiry = overall_balanced["expiry"]
    expiry_group = scored_calls[scored_calls["expiry"] == selected_expiry]

    income_in_expiry, balanced_in_expiry = pick_best_options(expiry_group)

    total_contracts = get_total_contracts(shares)
    income_contracts = int(total_contracts * 0.40)
    balanced_contracts = total_contracts - income_contracts

    plan = allocate_manual(
        total_shares=shares,
        expiry=selected_expiry,
        allocations=[
            {"strike": income_in_expiry["strike"], "contracts": income_contracts},
            {"strike": balanced_in_expiry["strike"], "contracts": balanced_contracts},
        ]
    )

    for item in plan:
        print(
            f"Sell {item['contracts']} contracts | "
            f"Expiry: {item['expiry']} | "
            f"Strike: {item['strike']}"
        )

    print_section_header("Planned Open Positions")

    positions = create_positions_from_plan(
        ticker=ticker,
        plan=plan,
        scored_calls=scored_calls
    )

    def ceil_to_cent(x: float) -> float:
        return math.ceil(x * 100.0) / 100.0


    gross_premium = 0.0
    total_buyback_budget = 0.0

    for position in positions:
        contracts = int(position["contracts"])
        credit = float(position["premium_total"])

        # keep 85% => allow 15% buyback budget, rounded up to next $1
        buyback_budget = math.ceil(credit * 0.15)

        per_contract_budget = buyback_budget / contracts if contracts > 0 else 0.0
        limit_per_share = ceil_to_cent(per_contract_budget / 100.0) if contracts > 0 else 0.0

        print(
            f"{position['ticker']} | "
            f"Sell {position['contracts']} contracts | "
            f"Expiry: {position['expiry']} | "
            f"Strike: {position['strike']:.1f} | "
            f"Entry: ${position['entry_price']:.2f} | "
            f"Premium: ${position['premium_total']:.2f}"
        )
        print(
            f"  Buyback budget: ${buyback_budget:.0f} total | "
            f"${per_contract_budget:.2f}/contract (${limit_per_share:.2f}/share)"
        )
        print()  # <-- blank line between positions

        gross_premium += credit
        total_buyback_budget += buyback_budget

    net_premium = gross_premium - total_buyback_budget

    print(f"Gross Premium Collected: ${gross_premium:.2f}")
    print(f"Buyback Budget (85% kept): -${total_buyback_budget:.2f}")
    print(f"Net Premium After Buyback: ${net_premium:.2f}")

if __name__ == "__main__":
    main()