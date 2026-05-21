# filters.py
import pandas as pd

from config import ScannerConfig, DEFAULT_CONFIG
from quote_policy import apply_quote_policy_to_df


def filter_covered_calls(
    calls_df: pd.DataFrame,
    min_strike_price: float,
    stock_price: float,
    config: ScannerConfig = DEFAULT_CONFIG,
) -> pd.DataFrame:
    """
    Filter option candidates and attach premium/quote columns.

    Filters applied:
      - Strike within [min_strike_price, stock_price * max_strike_multiple]
      - premium_price >= min_premium
      - volume >= min_volume
      - open_interest >= min_open_interest  (liquidity signal)
      - spread_pct <= max_spread_pct        (quote quality signal)
    """
    if calls_df.empty:
        return calls_df

    df = calls_df.copy()

    numeric_columns = ["strike", "bid", "ask", "lastPrice", "volume", "openInterest"]
    for col in numeric_columns:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    df = apply_quote_policy_to_df(df, mode="mid_or_last")
    df["mid"] = ((df["bid"].fillna(0) + df["ask"].fillna(0)) / 2).round(3)

    # Spread % for filtering — (ask - bid) / mid
    df["spread_pct"] = (
        (df["ask"].fillna(0) - df["bid"].fillna(0)) /
        df["mid"].replace(0, float("nan"))
    ) * 100

    max_strike_price = stock_price * config.max_strike_multiple

    mask = (
        (df["strike"] >= min_strike_price) &
        (df["strike"] <= max_strike_price) &
        (df["premium_price"] >= config.min_premium) &
        (df["volume"].fillna(0) >= config.min_volume) &
        (df["openInterest"].fillna(0) >= config.min_open_interest) &
        (df["spread_pct"].fillna(float("inf")) <= config.max_spread_pct * 100)
    )

    return df[mask].copy()
