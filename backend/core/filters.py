# filters.py
import pandas as pd

from core.config import ScannerConfig, DEFAULT_CONFIG
from core.quotes import apply_quote_policy_to_df
from core.market_hours import NEW_YORK, last_session


def filter_covered_calls(
    calls_df: pd.DataFrame,
    min_strike_price: float,
    stock_price: float,
    config: ScannerConfig = DEFAULT_CONFIG,
    use_last_price: bool = False,
) -> pd.DataFrame:
    """
    Filter option candidates and attach premium/quote columns.

    premium_price is the likely fill when selling (see sell_fill_share), not the midpoint.

    Filters applied:
      - Strike within [min_strike_price, stock_price * max_strike_multiple]
      - premium_price >= min_premium
      - volume >= min_volume
      - open_interest >= min_open_interest  (liquidity signal)
      - spread_pct <= max_spread_pct        (quote quality signal)

    use_last_price=True (market closed / no live quotes): each option is priced
    at its last traded price, marked STALE, and the spread check is skipped
    because there is no live bid/ask to measure. A last trade from before the
    latest session (a quiet strike that hasn't traded for days) is marked OLD:
    the stock has moved since, so that price says little about today's.
    """
    if calls_df.empty:
        return calls_df

    df = calls_df.copy()

    numeric_columns = ["strike", "bid", "ask", "lastPrice", "volume", "openInterest"]
    for col in numeric_columns:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    df = apply_quote_policy_to_df(df, mode="mid_or_last")

    if use_last_price and "lastPrice" in df.columns:
        has_last = df["lastPrice"].fillna(0) > 0
        df.loc[has_last, "premium_price"] = df.loc[has_last, "lastPrice"]
        df.loc[has_last, "premium_source"] = "LAST"
        df.loc[has_last, "quote_quality"] = "STALE"
        df.loc[has_last, "warning"] = "Last traded price (market closed)"
        if "lastTradeDate" in df.columns:
            traded = pd.to_datetime(df["lastTradeDate"], errors="coerce", utc=True).dt.tz_convert(NEW_YORK).dt.date
            old = has_last & traded.notna() & (traded < last_session())
            df["last_trade_date"] = traded.map(lambda d: d.isoformat() if pd.notna(d) else None)
            df.loc[old, "quote_quality"] = "OLD"
            df.loc[old, "warning"] = "Last traded before the latest session"
    df["mid"] = ((df["bid"].fillna(0) + df["ask"].fillna(0)) / 2).round(3)

    # Price live quotes at a realistic sell fill, not the midpoint: a sell order
    # usually fills between the bid and the mid, and the wider the spread, the
    # more that costs you. (Last-traded prices, when the market is closed, stay as is.)
    live = df["premium_source"] == "MID"
    df.loc[live, "premium_price"] = (
        df.loc[live, "bid"] + config.sell_fill_share * (df.loc[live, "ask"] - df.loc[live, "bid"])
    ).round(3)

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
        (use_last_price | (df["spread_pct"].fillna(float("inf")) <= config.max_spread_pct * 100))
    )

    return df[mask].copy()
