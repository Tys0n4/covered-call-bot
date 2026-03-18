import pandas as pd


def filter_covered_calls(
    calls_df,
    min_strike_price,
    stock_price,
    min_premium=0.05,
    min_volume=10,
    max_strike_multiple=1.50
):
    if calls_df.empty:
        return calls_df

    df = calls_df.copy()

    numeric_columns = ["strike", "bid", "ask", "lastPrice", "volume", "openInterest"]
    for col in numeric_columns:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    df["mid_temp"] = (df["bid"] + df["ask"]) / 2

    df["premium_price"] = df["bid"]
    df.loc[df["premium_price"].isna() | (df["premium_price"] <= 0), "premium_price"] = df["mid_temp"]
    df.loc[df["premium_price"].isna() | (df["premium_price"] <= 0), "premium_price"] = df["lastPrice"]
    df.loc[df["premium_price"].isna() | (df["premium_price"] <= 0), "premium_price"] = df["ask"]

    max_strike_price = stock_price * max_strike_multiple

    strike_min_condition = df["strike"] >= min_strike_price
    strike_max_condition = df["strike"] <= max_strike_price
    premium_condition = df["premium_price"] >= min_premium
    volume_condition = df["volume"].fillna(0) >= min_volume

    filtered = df[
        strike_min_condition &
        strike_max_condition &
        premium_condition &
        volume_condition
    ].copy()

    return filtered