# ticker_check.py
"""Check a ticker is real and has listed options before adding it."""
from __future__ import annotations

import logging

log = logging.getLogger(__name__)


def has_listed_options(ticker: str) -> bool | None:
    """
    True  = Yahoo lists option expiries for this ticker
    False = the ticker has no listed options (or doesn't exist)
    None  = couldn't check (e.g. Yahoo unreachable); callers shouldn't block on this
    """
    try:
        import yfinance as yf
        return len(yf.Ticker(ticker).options or ()) > 0
    except Exception as e:  # network trouble, rate limit, unexpected response
        log.warning("Couldn't check options for %s: %s", ticker, e)
        return None
