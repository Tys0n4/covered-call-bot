# greeks.py
"""
Delta (the chance a call ends up in the money) for each option, from Black-Scholes.

The volatility it needs comes from, in order:
  1. Yahoo's implied volatility for the option
  2. outside market hours Yahoo reports ~0 there, so it's worked out from the
     option's own price (the volatility that makes Black-Scholes match it),
     unless that price is a trade from before the latest session (quote_quality OLD)
  3. the stock's recent realized volatility, if neither works
"""
import math

import pandas as pd

MIN_VOL, MAX_VOL = 0.01, 5.0     # below 1% is Yahoo's after-hours placeholder, not a volatility


def normal_cdf(x):
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def _d1(stock_price, strike, t, vol, r, q):
    return (math.log(stock_price / strike) + (r - q + 0.5 * vol ** 2) * t) / (vol * math.sqrt(t))


def _valid_vol(v) -> bool:
    return v is not None and not pd.isna(v) and MIN_VOL <= float(v) <= MAX_VOL


def call_price(stock_price, strike, days_to_expiry, vol, risk_free_rate=0.04, dividend_yield=0.0):
    """Black-Scholes price of a call, per share."""
    t = days_to_expiry / 365.0
    d1 = _d1(stock_price, strike, t, vol, risk_free_rate, dividend_yield)
    d2 = d1 - vol * math.sqrt(t)
    return (stock_price * math.exp(-dividend_yield * t) * normal_cdf(d1)
            - strike * math.exp(-risk_free_rate * t) * normal_cdf(d2))


def implied_vol_from_price(price, stock_price, strike, days_to_expiry, risk_free_rate=0.04, dividend_yield=0.0):
    """
    The volatility at which Black-Scholes gives this option price, or None when
    the price can't come from any volatility (below what it's worth exercised now,
    or above the stock price).
    """
    if not price or price <= 0 or stock_price <= 0 or strike <= 0 or days_to_expiry <= 0:
        return None
    args = (stock_price, strike, days_to_expiry)
    low, high = MIN_VOL, MAX_VOL
    try:
        if not call_price(*args, low, risk_free_rate, dividend_yield) <= price <= call_price(*args, high, risk_free_rate, dividend_yield):
            return None
        for _ in range(60):                   # bisection: the price rises with volatility
            mid = (low + high) / 2
            if call_price(*args, mid, risk_free_rate, dividend_yield) < price:
                low = mid
            else:
                high = mid
        return (low + high) / 2
    except (ValueError, ZeroDivisionError, OverflowError):
        return None


def estimate_call_delta(stock_price, strike, days_to_expiry, implied_volatility, risk_free_rate=0.04, dividend_yield=0.0):
    """Black-Scholes delta of a call (dividends lower it slightly), or None without a usable volatility."""
    if stock_price <= 0 or strike <= 0 or days_to_expiry <= 0 or not _valid_vol(implied_volatility):
        return None
    t = days_to_expiry / 365.0
    try:
        d1 = _d1(stock_price, strike, t, float(implied_volatility), risk_free_rate, dividend_yield)
        return round(math.exp(-dividend_yield * t) * normal_cdf(d1), 3)
    except (ValueError, ZeroDivisionError):
        return None


def add_estimated_delta(calls_df, stock_price, risk_free_rate=0.04, *, dividend_yield=0.0, fallback_vol=None):
    """
    Add 'delta' and 'delta_source' ("implied" | "price" | "history" | None).

    Black-Scholes, with the volatility from (in order):
      1. Yahoo's implied volatility.
      2. The volatility implied by the option's price (midpoint, else last
         trade): Yahoo's is junk outside market hours.
      3. fallback_vol (the stock's recent realized volatility).
    """
    df = calls_df.copy()

    def _option_price(row):
        # A last trade from days ago was made at a different stock price, so it
        # can't tell today's volatility
        cols = ("mid",) if row.get("quote_quality") == "OLD" else ("mid", "lastPrice")
        for col in cols:
            v = row.get(col)
            if v is not None and not pd.isna(v) and float(v) > 0:
                return float(v)
        return None

    def _resolve(row):
        strike, days = row.get("strike"), row.get("dte")
        vol, source = row.get("impliedVolatility"), "implied"
        if not _valid_vol(vol):
            vol = implied_vol_from_price(_option_price(row), stock_price, strike, days, risk_free_rate, dividend_yield)
            source = "price"
        if not _valid_vol(vol):
            vol, source = fallback_vol, "history"
        delta = estimate_call_delta(stock_price, strike, days, vol, risk_free_rate, dividend_yield)
        return (delta, source) if delta is not None else (None, None)

    resolved = df.apply(_resolve, axis=1, result_type="expand") if not df.empty else None
    df["delta"] = resolved[0] if resolved is not None else []
    df["delta_source"] = resolved[1] if resolved is not None else []
    return df
