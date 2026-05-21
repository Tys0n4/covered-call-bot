# options_data.py
# Stock price -> Alpha Vantage (accurate, free)
# Options chain -> yfinance (full chain, free; quote staleness handled by quote_policy.py)

import yfinance as yf
import pandas as pd
from datetime import datetime


def get_call_options_in_dte_range(
    ticker_symbol: str,
    min_dte: int = 24,
    max_dte: int = 38,
) -> pd.DataFrame:
    """
    Fetch call options within the DTE window using yfinance.
    Quote quality (LIVE/STALE/BAD) is handled downstream by quote_policy.py.
    """
    ticker = yf.Ticker(ticker_symbol)
    expirations = ticker.options

    if not expirations:
        print(f"No option expirations found for {ticker_symbol}.")
        return pd.DataFrame()

    today = datetime.today().date()
    all_calls = []

    for expiry_str in expirations:
        try:
            expiry_date = datetime.strptime(expiry_str, "%Y-%m-%d").date()
        except ValueError:
            continue

        dte = (expiry_date - today).days

        if min_dte <= dte <= max_dte:
            chain = ticker.option_chain(expiry_str)
            calls = chain.calls.copy()

            if calls.empty:
                continue

            calls["expiry"] = expiry_str
            calls["dte"] = dte
            all_calls.append(calls)

    if not all_calls:
        return pd.DataFrame()

    return pd.concat(all_calls, ignore_index=True)