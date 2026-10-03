# options_data.py
# Stock price -> Alpha Vantage (accurate, free)
# Options chain -> yfinance (full chain, free; quote staleness handled by quote_policy.py)

import logging

import yfinance as yf
import pandas as pd
from datetime import datetime

from cache import CHAIN_TTL, EXPIRIES_TTL, cached
from market_hours import market_today

log = logging.getLogger(__name__)


def get_expiries(ticker_symbol: str) -> tuple[str, ...]:
    """Listed option expiry dates (cached for a few minutes)."""
    def fetch():
        try:
            return tuple(yf.Ticker(ticker_symbol).options or ()) or None
        except Exception as e:
            log.warning("Yahoo expiries for %s failed: %s", ticker_symbol, e)
            return None
    return cached(("expiries", ticker_symbol), EXPIRIES_TTL, fetch) or ()


def get_calls(ticker_symbol: str, expiry: str) -> pd.DataFrame | None:
    """
    The call side of one option chain, cached for a minute so a scan followed
    by a price check doesn't download it twice. Callers must not modify it
    (copy first). None if it couldn't be fetched.
    """
    def fetch():
        try:
            return yf.Ticker(ticker_symbol).option_chain(expiry).calls
        except Exception as e:
            log.warning("Yahoo chain for %s %s failed: %s", ticker_symbol, expiry, e)
            return None
    return cached(("calls", ticker_symbol, expiry), CHAIN_TTL, fetch)


def get_call_options_in_dte_range(
    ticker_symbol: str,
    min_dte: int = 24,
    max_dte: int = 38,
) -> pd.DataFrame:
    """
    Fetch call options within the DTE window using yfinance.
    Quote quality (LIVE/STALE/BAD) is handled downstream by quote_policy.py.
    """
    expirations = get_expiries(ticker_symbol)

    if not expirations:
        log.info("No option expirations found for %s.", ticker_symbol)
        return pd.DataFrame()

    today = datetime.strptime(market_today(), "%Y-%m-%d").date()
    all_calls = []

    for expiry_str in expirations:
        try:
            expiry_date = datetime.strptime(expiry_str, "%Y-%m-%d").date()
        except ValueError:
            continue

        dte = (expiry_date - today).days

        if min_dte <= dte <= max_dte:
            chain = get_calls(ticker_symbol, expiry_str)
            if chain is None or chain.empty:
                continue
            calls = chain.copy()
            calls["expiry"] = expiry_str
            calls["dte"] = dte
            all_calls.append(calls)

    if not all_calls:
        return pd.DataFrame()

    return pd.concat(all_calls, ignore_index=True)
