# greeks.py
import math
import pandas as pd


def normal_cdf(x):
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def estimate_call_delta(stock_price, strike, days_to_expiry, implied_volatility, risk_free_rate=0.04):
    """Black-Scholes delta estimate — used only when provider delta is unavailable."""
    if stock_price <= 0 or strike <= 0 or days_to_expiry <= 0:
        return None
    if implied_volatility is None or pd.isna(implied_volatility) or implied_volatility <= 0:
        return None

    T = days_to_expiry / 365.0
    try:
        d1 = (
            math.log(stock_price / strike) +
            (risk_free_rate + 0.5 * implied_volatility ** 2) * T
        ) / (implied_volatility * math.sqrt(T))
        return round(normal_cdf(d1), 3)
    except (ValueError, ZeroDivisionError):
        return None


def add_estimated_delta(calls_df, stock_price, risk_free_rate=0.04):
    """
    Populate the 'delta' column.

    Priority:
      1. Use 'av_delta' from Alpha Vantage if present and valid.
      2. Fall back to Black-Scholes estimate using impliedVolatility.
    """
    df = calls_df.copy()

    def _resolve_delta(row):
        # Prefer provider-supplied delta
        av = row.get("av_delta")
        if av is not None and not (isinstance(av, float) and pd.isna(av)):
            try:
                val = float(av)
                if 0.0 <= val <= 1.0:
                    return round(val, 3)
            except (ValueError, TypeError):
                pass

        # Fall back to Black-Scholes
        return estimate_call_delta(
            stock_price=stock_price,
            strike=row.get("strike"),
            days_to_expiry=row.get("dte"),
            implied_volatility=row.get("impliedVolatility"),
            risk_free_rate=risk_free_rate,
        )

    df["delta"] = df.apply(_resolve_delta, axis=1)
    return df
