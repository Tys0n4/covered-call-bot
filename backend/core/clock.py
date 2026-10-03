# clock.py
"""
Dates the app stamps on your trades (opened / closed) use YOUR time zone,
not the server's (Railway runs on UTC). Set APP_TIMEZONE to change it.
"""
import os
from datetime import datetime
from zoneinfo import ZoneInfo

APP_TIMEZONE = ZoneInfo(os.environ.get("APP_TIMEZONE", "America/Edmonton"))


def local_today() -> str:
    """Today's date where you are, as YYYY-MM-DD."""
    return datetime.now(APP_TIMEZONE).strftime("%Y-%m-%d")
