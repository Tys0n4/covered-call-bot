# cboe.py
"""
Option chains from Cboe's delayed quotes (about 15 minutes behind, free, no
key): every expiry for a stock in one download, with the exchange's own
implied volatility and delta. This is the main source; Yahoo is the fallback
when Cboe fails or has nothing for a stock (options_data.py).

The endpoint is the one Cboe's website uses, not a documented API, so the
parsing is defensive: anything unexpected means "no Cboe data" and the app
uses Yahoo instead of failing.
"""
from __future__ import annotations

import logging
import re

import pandas as pd
import requests

from core.cache import CHAIN_TTL, cached
from core.market_hours import NEW_YORK

log = logging.getLogger(__name__)

URL = "https://cdn.cboe.com/api/global/delayed_quotes/options/{symbol}.json"
# OCC option symbol: root, expiry YYMMDD, C/P, strike x 1000 (8 digits), e.g. AAPL261016C00245000
OCC = re.compile(r"^(?P<root>[A-Z.]+?)(?P<date>\d{6})(?P<cp>[CP])(?P<strike>\d{8})$")


def _download(symbol: str) -> dict | None:
    try:
        r = requests.get(URL.format(symbol=symbol), headers={"User-Agent": "Mozilla/5.0"}, timeout=10)
        if r.status_code != 200:
            log.info("Cboe has no chain for %s (HTTP %s)", symbol, r.status_code)
            return None
        return r.json()
    except Exception as e:                       # network, timeout, bad JSON
        log.warning("Cboe chain for %s failed: %s", symbol, e)
        return None


def _num(v) -> float | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if pd.isna(f) else f


def _trade_time(v) -> pd.Timestamp | None:
    """Cboe's last trade time, read as New York time when it has no zone."""
    try:
        ts = pd.Timestamp(v)
    except (TypeError, ValueError):
        return None
    if pd.isna(ts):
        return None
    return ts.tz_localize(NEW_YORK) if ts.tzinfo is None else ts


def parse_calls(payload: dict | None, ticker: str) -> pd.DataFrame | None:
    """
    The calls in a Cboe payload, in the same columns as Yahoo's chain plus
    cboe_delta and source="cboe". Adjusted contracts (other roots) are skipped.
    None when there are no usable calls.
    """
    try:
        options = payload["data"]["options"]
    except (TypeError, KeyError):
        return None
    root = ticker.upper().replace("-", ".")
    rows = []
    for o in options or []:
        if not isinstance(o, dict):
            continue
        m = OCC.match(str(o.get("option", "")))
        if not m or m["cp"] != "C" or m["root"] != root:
            continue
        d = m["date"]
        rows.append({
            "contractSymbol": o.get("option"),
            "expiry": f"20{d[:2]}-{d[2:4]}-{d[4:]}",
            "strike": int(m["strike"]) / 1000,
            "bid": _num(o.get("bid")),
            "ask": _num(o.get("ask")),
            "lastPrice": _num(o.get("last_trade_price")),
            "volume": _num(o.get("volume")),
            "openInterest": _num(o.get("open_interest")),
            "impliedVolatility": _num(o.get("iv")),
            "cboe_delta": _num(o.get("delta")),
            "lastTradeDate": _trade_time(o.get("last_trade_time")),
            "source": "cboe",
        })
    if not rows:
        return None
    return pd.DataFrame(rows)


def get_cboe_calls(ticker: str) -> pd.DataFrame | None:
    """Every call for a stock from Cboe (cached for a minute), or None."""
    return cached(("cboe", ticker.upper()), CHAIN_TTL, lambda: parse_calls(_download(ticker.upper()), ticker))
