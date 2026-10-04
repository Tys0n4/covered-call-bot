# events.py
"""
Market events that can move a stock before a call expires, beyond its own
earnings (market_data.get_events):

  - Fed (FOMC) rate decisions: move the whole market
  - earnings from the biggest companies in the stock's industry, and from
    other stocks you hold in the same industry: they often move the group

Expiries that span one of these are flagged on the Scanner, the picks lean
toward the safe end of your delta range, and open calls are bought back
earlier (strategy.event_buyback_pct).
"""
from __future__ import annotations

from core.market_data import get_events, get_info
from core.market_hours import market_today

# FOMC rate decision days (the second day of each meeting), from the Federal
# Reserve's published calendar. The Fed publishes each year's dates in advance:
# add the next year's here once they're confirmed on federalreserve.gov/monetarypolicy/fomccalendars.htm.
# Only confirmed dates: past the last one, the Scanner says the calendar ends there.
FED_MEETINGS: tuple[str, ...] = (
    "2026-01-28", "2026-03-18", "2026-04-29", "2026-06-17",
    "2026-07-29", "2026-09-16", "2026-10-28", "2026-12-09",
)

# The largest companies in common Yahoo Finance industries. Their earnings tend
# to move the rest of the industry. Industries not listed here only use your own
# holdings in the same industry.
INDUSTRY_LEADERS: dict[str, tuple[str, ...]] = {
    "Semiconductors": ("NVDA", "AVGO", "AMD", "TSM"),
    "Semiconductor Equipment & Materials": ("ASML", "AMAT", "LRCX"),
    "Software - Infrastructure": ("MSFT", "ORCL", "PANW"),
    "Software - Application": ("CRM", "INTU", "NOW"),
    "Consumer Electronics": ("AAPL", "SONY"),
    "Internet Retail": ("AMZN", "BABA", "PDD"),
    "Internet Content & Information": ("GOOGL", "META"),
    "Auto Manufacturers": ("TSLA", "TM", "GM"),
    "Banks - Diversified": ("JPM", "BAC", "WFC"),
    "Drug Manufacturers - General": ("LLY", "JNJ", "MRK"),
    "Oil & Gas Integrated": ("XOM", "CVX"),
    "Discount Stores": ("WMT", "COST"),
    "Credit Services": ("V", "MA"),
    "Entertainment": ("NFLX", "DIS"),
}

def industry_of(ticker: str) -> str | None:
    """Yahoo Finance's industry for a stock (e.g. "Semiconductors"), or None."""
    return get_info(ticker).get("industry") or None


def last_fed_meeting() -> str | None:
    """The last Fed decision day the app knows about."""
    return max(FED_MEETINGS) if FED_MEETINGS else None


def fed_meetings_between(start: str, end: str) -> list[str]:
    """Fed decision days from start to end (YYYY-MM-DD, inclusive)."""
    return [d for d in FED_MEETINGS if start <= d <= end]


def related_earnings(ticker: str, holdings: list[str], today: str | None = None) -> list[dict]:
    """
    Upcoming earnings that can move this stock's industry: the industry's
    leaders, and your other holdings in the same industry.
    [{"ticker", "date", "why": "leader" | "yours"}], soonest first.
    """
    today = today or market_today()
    industry = industry_of(ticker)
    if not industry:
        return []
    related: dict[str, str] = {t: "leader" for t in INDUSTRY_LEADERS.get(industry, ()) if t != ticker}
    for other in holdings:
        if other != ticker and other not in related and industry_of(other) == industry:
            related[other] = "yours"
    out = []
    for other, why in related.items():
        when = get_events(other).get("earnings_date")
        if when and when >= today:
            out.append({"ticker": other, "date": when, "why": why})
    return sorted(out, key=lambda e: (e["date"], e["ticker"]))
