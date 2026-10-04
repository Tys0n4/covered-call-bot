# options_data.py
# Stock price -> Alpha Vantage (accurate, free)
# Options chain -> Cboe delayed quotes (core/cboe.py), else yfinance when Cboe
# fails or has nothing for the stock. Each row says which in its "source" column.

import logging

import yfinance as yf
import pandas as pd
from datetime import datetime

from core.cache import CHAIN_TTL, EXPIRIES_TTL, cached
from core.cboe import get_cboe_calls
from core.market_hours import market_today

log = logging.getLogger(__name__)


def get_expiries(ticker_symbol: str) -> tuple[str, ...]:
    """Listed option expiry dates: Cboe's, else Yahoo's (cached for a few minutes)."""
    cboe = get_cboe_calls(ticker_symbol)
    if cboe is not None and not cboe.empty:
        return tuple(sorted(cboe["expiry"].unique()))

    def fetch():
        try:
            return tuple(yf.Ticker(ticker_symbol).options or ()) or None
        except Exception as e:
            log.warning("Yahoo expiries for %s failed: %s", ticker_symbol, e)
            return None
    return cached(("expiries", ticker_symbol), EXPIRIES_TTL, fetch) or ()


def get_calls(ticker_symbol: str, expiry: str) -> pd.DataFrame | None:
    """
    The call side of one option chain (Cboe, else Yahoo), cached for a minute
    so a scan followed by a price check doesn't download it twice. Callers must
    not modify it (copy first). None if it couldn't be fetched.
    """
    cboe = get_cboe_calls(ticker_symbol)
    if cboe is not None:
        calls = cboe[cboe["expiry"] == expiry]
        if not calls.empty:
            return calls.reset_index(drop=True)

    def fetch():
        try:
            calls = yf.Ticker(ticker_symbol).option_chain(expiry).calls.copy()
            calls["source"] = "yahoo"
            return calls
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
    Fetch call options within the DTE window (Cboe, else Yahoo).
    Quote quality (LIVE/STALE/BAD) is handled downstream by quotes.py.
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
