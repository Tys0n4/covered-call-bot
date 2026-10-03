# calculations.py
def add_option_metrics(calls_df, stock_price, fee_per_contract: float = 0.0):
    """
    Yields are on what you actually keep: the likely fill (premium_price)
    minus the commission, so options are ranked by real income.
    """
    df = calls_df.copy()

    df["mid"] = df.get("mid", (df["bid"] + df["ask"]) / 2)

    df["premium_per_contract"] = df["premium_price"] * 100
    df["net_per_contract"] = df["premium_per_contract"] - fee_per_contract
    net_per_share = df["net_per_contract"] / 100
    df["premium_yield_pct"] = (net_per_share / stock_price) * 100

    # Annualized yield — fair comparison across different DTEs
    # (net premium / stock_price) / dte * 365 * 100
    df["annualized_yield_pct"] = (
        (net_per_share / stock_price) / df["dte"] * 365 * 100
    )

    df["upside_to_strike_pct"] = ((df["strike"] - stock_price) / stock_price) * 100

    # Bid-ask spread as % of mid — quality signal
    df["spread_pct"] = (
        (df["ask"].fillna(0) - df["bid"].fillna(0)) /
        df["mid"].replace(0, float("nan"))
    ) * 100

    df["mid"] = df["mid"].round(3)
    df["premium_price"] = df["premium_price"].round(3)
    df["premium_per_contract"] = df["premium_per_contract"].round(2)
    df["net_per_contract"] = df["net_per_contract"].round(2)
    df["premium_yield_pct"] = df["premium_yield_pct"].round(2)
    df["annualized_yield_pct"] = df["annualized_yield_pct"].round(2)
    df["upside_to_strike_pct"] = df["upside_to_strike_pct"].round(2)
    df["spread_pct"] = df["spread_pct"].round(1)

    return df
