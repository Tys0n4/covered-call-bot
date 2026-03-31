import pandas as pd


def filter_covered_calls(
    calls_df,
    min_strike_price,
    stock_price,
    min_premium=0.10,
    min_volume=10,
    max_strike_multiple=1.50
):
    """
    Premium rules:
      - LIVE: bid>0 and ask>0 and ask>=bid => premium_price = midpoint, premium_source=MID
      - STALE: otherwise if lastPrice>0 => premium_price = lastPrice, premium_source=LAST
      - BAD: otherwise => premium_price = 0, premium_source=NONE

    Adds:
      premium_source, quote_quality, warning
    """
    if calls_df.empty:
        return calls_df

    df = calls_df.copy()

    numeric_columns = ["strike", "bid", "ask", "lastPrice", "volume", "openInterest"]
    for col in numeric_columns:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    df["mid"] = (df["bid"] + df["ask"]) / 2

    bid_ok = df["bid"].fillna(0) > 0
    ask_ok = df["ask"].fillna(0) > 0
    spread_ok = df["ask"].fillna(0) >= df["bid"].fillna(0)
    live_mask = bid_ok & ask_ok & spread_ok

    last_ok = df["lastPrice"].fillna(0) > 0
    stale_mask = (~live_mask) & last_ok

    df["premium_price"] = 0.0
    df["premium_source"] = "NONE"
    df["quote_quality"] = "BAD"
    df["warning"] = "Verify on broker"

    df.loc[live_mask, "premium_price"] = df.loc[live_mask, "mid"]
    df.loc[live_mask, "premium_source"] = "MID"
    df.loc[live_mask, "quote_quality"] = "LIVE"
    df.loc[live_mask, "warning"] = ""

    df.loc[stale_mask, "premium_price"] = df.loc[stale_mask, "lastPrice"]
    df.loc[stale_mask, "premium_source"] = "LAST"
    df.loc[stale_mask, "quote_quality"] = "STALE"
    df.loc[stale_mask, "warning"] = "Verify on broker"

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