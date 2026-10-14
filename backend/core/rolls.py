# rolls.py
"""
Rolling a call: buying back the open call and selling a later one on the same
shares, usually at a higher strike ("up and out") when the stock has run past
the strike. find_rolls() looks at expiries after the current one, up to
ROLL_DAYS later, with strikes at or above the current strike, and keeps those
that pay a credit after both commissions:

  - for each strike, the soonest expiry that pays a credit (the least time
    locked in for it)
  - ranked by how much higher the strike goes (more room for the stock to
    rise before your shares are called), then by the credit

Prices are midpoints, like the rest of the app: buying back the open call at
get_current_option_quote's price, selling the new one at the scanner's.
"""
from __future__ import annotations

from dataclasses import replace
from datetime import date

import pandas as pd

from core.buyback import get_current_option_quote
from core.config import DEFAULT_CONFIG, ScannerConfig
from core.events import fed_meetings_between
from core.fees import typical_fee_per_contract
from core.filters import filter_covered_calls
from core.greeks import add_estimated_delta
from core.market_data import get_dividend_yield, get_events, get_price_quote
from core.market_hours import delayed_quotes_live, market_today
from core.options_data import get_call_options_in_dte_range

ROLL_DAYS = 45      # look at expiries up to this many days after the current one
MAX_ROLLS = 5


def find_rolls(position: dict, config: ScannerConfig = DEFAULT_CONFIG, today: str | None = None) -> dict:
    """
    {"buyback_price", "stock_price", "quotes_live", "rolls": [...], "note"} for an
    open call. Each roll: expiry, dte, strike, price (the new call, per share),
    net_per_share and net_total (the credit, after both commissions), strike_gain
    (what the higher strike adds if your shares are called), delta, above_range,
    spans_earnings, spans_fed. note says why there are none, when there are none.
    """
    ticker, contracts = position["ticker"], int(position["contracts"])
    old_strike, old_expiry = float(position["strike"]), position["expiry"]
    today = today or market_today()
    days_left = (date.fromisoformat(old_expiry) - date.fromisoformat(today)).days
    quotes_live = delayed_quotes_live()
    out = {"buyback_price": None, "stock_price": None, "quotes_live": quotes_live, "rolls": [], "note": None}

    stock_price, _ = get_price_quote(ticker)
    out["stock_price"] = stock_price
    old = get_current_option_quote(ticker, old_expiry, old_strike, strike_tolerance=config.strike_match_tolerance)
    if not stock_price or old["price"] <= 0:
        out["note"] = f"There's no current price for the {ticker} call to buy back, so rolls can't be priced right now."
        return out
    buyback = round(float(old["price"]), 2)   # options trade in cents: net the prices as shown
    out["buyback_price"] = buyback

    chain = get_call_options_in_dte_range(ticker, min_dte=max(days_left, 0) + 1, max_dte=max(days_left, 0) + ROLL_DAYS)
    if chain.empty:
        out["note"] = f"{ticker} has no later expiries within {ROLL_DAYS} days of this one."
        return out

    # Later expiries are often traded less: no volume minimum, a low open-interest one
    lenient = replace(config, min_volume=0, min_open_interest=min(config.min_open_interest, 10), min_premium=0.01)
    has_quotes = {"bid", "ask"} <= set(chain.columns) and bool(
        ((pd.to_numeric(chain["bid"], errors="coerce").fillna(0) > 0) & (pd.to_numeric(chain["ask"], errors="coerce").fillna(0) > 0)).any())
    calls = filter_covered_calls(chain, min_strike_price=old_strike, stock_price=stock_price, config=lenient,
                                 use_last_price=not (quotes_live and has_quotes))
    calls = calls[calls["quote_quality"] != "OLD"] if "quote_quality" in calls.columns else calls
    if calls.empty:
        out["note"] = f"No later {ticker} call at or above the ${old_strike:,.2f} strike has a usable price right now."
        return out

    calls = add_estimated_delta(calls, stock_price, risk_free_rate=config.risk_free_rate,
                                dividend_yield=get_dividend_yield(ticker, stock_price))
    fee = typical_fee_per_contract()
    calls["price"] = calls["premium_price"].astype(float).round(2)
    calls["net_per_share"] = (calls["price"] - buyback).round(2)
    calls["net_total"] = calls["net_per_share"] * 100 * contracts - 2 * fee * contracts
    credit = calls[calls["net_total"] > 0]
    if credit.empty:
        out["note"] = (f"No later call at or above ${old_strike:,.2f} pays more than the ${buyback:.2f} "
                       "it costs to buy this one back, so any roll right now would be a debit.")
        return out

    # The soonest expiry that pays a credit, for each strike; the highest strikes first
    soonest = credit.sort_values(["strike", "expiry"]).drop_duplicates("strike", keep="first")
    best = soonest.sort_values(["strike", "net_total"], ascending=[False, False]).head(MAX_ROLLS)

    earnings = get_events(ticker).get("earnings_date")
    for _, row in best.iterrows():
        expiry = str(row["expiry"])
        delta = None if pd.isna(row.get("delta")) else float(row["delta"])
        out["rolls"].append({
            "expiry": expiry,
            "dte": int(row["dte"]),
            "strike": float(row["strike"]),
            "price": float(row["price"]),
            "net_per_share": float(row["net_per_share"]),
            "net_total": round(float(row["net_total"]), 2),
            "strike_gain": round((float(row["strike"]) - old_strike) * 100 * contracts, 2),
            "delta": delta,
            "above_range": delta is not None and delta > config.delta_max,
            "spans_earnings": bool(earnings and today <= earnings <= expiry),
            "spans_fed": bool(fed_meetings_between(today, expiry)),
        })
    return out
