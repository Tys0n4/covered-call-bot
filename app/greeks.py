import math
import pandas as pd


def normal_cdf(x):
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def estimate_call_delta(stock_price, strike, days_to_expiry, implied_volatility, risk_free_rate=0.04):
    # Returns an estimated Black-Scholes call delta.

    if stock_price <= 0 or strike <= 0 or days_to_expiry <= 0:
        return None

    if implied_volatility is None or pd.isna(implied_volatility) or implied_volatility <= 0:
        return None

    T = days_to_expiry / 365.0
    sigma = implied_volatility
    r = risk_free_rate

    try:
        d1 = (
            math.log(stock_price / strike) +
            (r + 0.5 * sigma ** 2) * T
        ) / (sigma * math.sqrt(T))

        delta = normal_cdf(d1)
        return round(delta, 3)

    except (ValueError, ZeroDivisionError):
        return None


def add_estimated_delta(calls_df, stock_price, risk_free_rate=0.04):
    df = calls_df.copy()

    if "impliedVolatility" not in df.columns:
        df["delta"] = None
        return df

    df["delta"] = df.apply(
        lambda row: estimate_call_delta(
            stock_price=stock_price,
            strike=row["strike"],
            days_to_expiry=row["dte"],
            implied_volatility=row["impliedVolatility"],
            risk_free_rate=risk_free_rate,
        ),
        axis=1
    )

    return df