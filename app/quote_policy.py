# quote_policy.py
"""
Single source of truth for how option premiums are selected from raw market data.

Used by:
  - filters.py   (entry premium at scan time)
  - management.py (current mark for buyback decisions)

QuoteResult fields
------------------
price         : float — the chosen price (0.0 if BAD)
source        : "MID" | "LAST" | "NONE"
quality       : "LIVE" | "STALE" | "BAD"
warning       : str — empty string when quality is LIVE
"""

from __future__ import annotations
from dataclasses import dataclass
from typing import Literal


QuoteMode = Literal["mid_or_last", "ask", "bid"]


@dataclass(frozen=True)
class QuoteResult:
    price: float
    source: str      # "MID" | "LAST" | "NONE"
    quality: str     # "LIVE" | "STALE" | "BAD"
    warning: str     # "" when LIVE


def select_quote(
    bid: float | None,
    ask: float | None,
    last_price: float | None,
    *,
    mode: QuoteMode = "mid_or_last",
) -> QuoteResult:
    """
    Determine the best available price from raw bid/ask/last.

    mode='mid_or_last'  (default, used for entry scanning)
        LIVE  → midpoint when bid > 0, ask > 0, ask >= bid
        STALE → lastPrice when bid/ask unusable but last > 0
        BAD   → 0.0

    mode='ask'  (conservative: used for buyback cost estimates)
        ask if > 0, else lastPrice, else 0.0

    mode='bid'  (aggressive: least-likely-to-fill optimistic price)
        bid if > 0, else lastPrice, else 0.0
    """
    b = float(bid or 0.0)
    a = float(ask or 0.0)
    last = float(last_price or 0.0)

    if mode == "ask":
        if a > 0:
            return QuoteResult(price=a, source="ASK", quality="LIVE", warning="")
        if last > 0:
            return QuoteResult(price=last, source="LAST", quality="STALE", warning="Verify on broker")
        return QuoteResult(price=0.0, source="NONE", quality="BAD", warning="Verify on broker")

    if mode == "bid":
        if b > 0:
            return QuoteResult(price=b, source="BID", quality="LIVE", warning="")
        if last > 0:
            return QuoteResult(price=last, source="LAST", quality="STALE", warning="Verify on broker")
        return QuoteResult(price=0.0, source="NONE", quality="BAD", warning="Verify on broker")

    # default: mid_or_last
    live = b > 0 and a > 0 and a >= b
    if live:
        mid = (b + a) / 2.0
        return QuoteResult(price=round(mid, 4), source="MID", quality="LIVE", warning="")
    if last > 0:
        return QuoteResult(price=last, source="LAST", quality="STALE", warning="Verify on broker")
    return QuoteResult(price=0.0, source="NONE", quality="BAD", warning="Verify on broker")


def apply_quote_policy_to_df(df, *, mode: QuoteMode = "mid_or_last"):
    """
    Vectorised wrapper: adds premium_price, premium_source, quote_quality, warning
    columns to a DataFrame that has bid, ask, lastPrice columns.
    Returns a *copy* of the DataFrame.
    """
    import pandas as pd

    df = df.copy()

    for col in ("bid", "ask", "lastPrice"):
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    results = df.apply(
        lambda row: select_quote(
            bid=row.get("bid"),
            ask=row.get("ask"),
            last_price=row.get("lastPrice"),
            mode=mode,
        ),
        axis=1,
    )

    df["premium_price"] = results.apply(lambda r: r.price)
    df["premium_source"] = results.apply(lambda r: r.source)
    df["quote_quality"] = results.apply(lambda r: r.quality)
    df["warning"] = results.apply(lambda r: r.warning)

    return df
