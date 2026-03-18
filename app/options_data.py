import yfinance as yf
import pandas as pd
from datetime import datetime


def get_call_options_in_dte_range(ticker_symbol, min_dte=24, max_dte=38):
    ticker = yf.Ticker(ticker_symbol)
    expirations = ticker.options

    if not expirations:
        return pd.DataFrame()

    today = datetime.today().date()
    all_calls = []

    for expiry_str in expirations:
        expiry_date = datetime.strptime(expiry_str, "%Y-%m-%d").date()
        dte = (expiry_date - today).days

        if min_dte <= dte <= max_dte:
            option_chain = ticker.option_chain(expiry_str)
            calls = option_chain.calls.copy()

            calls["expiry"] = expiry_str
            calls["dte"] = dte

            all_calls.append(calls)

    if not all_calls:
        return pd.DataFrame()

    combined_calls = pd.concat(all_calls, ignore_index=True)
    return combined_calls