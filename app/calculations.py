def add_option_metrics(calls_df, stock_price):
    df = calls_df.copy()

    df["mid"] = (df["bid"] + df["ask"]) / 2
    df["premium_per_contract"] = df["premium_price"] * 100
    df["premium_yield_pct"] = (df["premium_price"] / stock_price) * 100
    df["upside_to_strike_pct"] = ((df["strike"] - stock_price) / stock_price) * 100

    df["mid"] = df["mid"].round(3)
    df["premium_price"] = df["premium_price"].round(3)
    df["premium_per_contract"] = df["premium_per_contract"].round(2)
    df["premium_yield_pct"] = df["premium_yield_pct"].round(2)
    df["upside_to_strike_pct"] = df["upside_to_strike_pct"].round(2)

    return df