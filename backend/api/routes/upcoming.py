# api/routes/upcoming.py
# What's coming up for your stocks (Dashboard): Fed rate decisions and your holdings' earnings.
from datetime import date, timedelta

from fastapi import APIRouter, Query

from api.schemas import UpcomingEvents
from core.events import fed_meetings_between, last_fed_meeting
from core.market_data import get_events
from core.market_hours import market_today
from core.portfolio import load_portfolio

router = APIRouter(prefix="/upcoming", tags=["upcoming"])


@router.get("", response_model=UpcomingEvents)
def upcoming(days: int = Query(30, ge=1, le=90)):
    """Fed decisions and earnings for the stocks you hold, from today through `days` ahead."""
    today = market_today()
    end = (date.fromisoformat(today) + timedelta(days=days)).isoformat()
    earnings = []
    for holding in load_portfolio():
        when = get_events(holding.ticker).get("earnings_date")
        if when and today <= when <= end:
            earnings.append({"ticker": holding.ticker, "date": when})
    return {
        "fed": fed_meetings_between(today, end),
        "fed_known_until": last_fed_meeting(),
        "earnings": sorted(earnings, key=lambda e: (e["date"], e["ticker"])),
    }
