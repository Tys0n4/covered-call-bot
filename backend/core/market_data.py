# market_data.py
"""
Stock prices and calendar events.

Price: Alpha Vantage GLOBAL_QUOTE first (1 API call; the free plan allows ~25 a
day), then Yahoo Finance (yfinance) if Alpha Vantage has no key, is rate
limited or doesn't answer.
"""
import logging
import os
from datetime import date, datetime, timedelta
from pathlib import Path

import requests
import yfinance as yf
from dotenv import load_dotenv

from core.cache import CLOSE_TTL, EVENTS_TTL, HISTORY_TTL, PRICE_TTL, cached

load_dotenv(Path(__file__).resolve().parent.parent / ".env")   # backend/.env (local development)

log = logging.getLogger(__name__)

ALPHA_VANTAGE_KEY = os.getenv("ALPHA_VANTAGE_KEY")
BASE_URL = "https://www.alphavantage.co/query"


def _alpha_vantage_price(ticker_symbol: str) -> float | None:
    """'price' (last trade) during hours, falling back to 'previous close'."""
    if not ALPHA_VANTAGE_KEY:
        return None
    params = {"function": "GLOBAL_QUOTE", "symbol": ticker_symbol, "apikey": ALPHA_VANTAGE_KEY}
    try:
        response = requests.get(BASE_URL, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()
    except (requests.RequestException, ValueError) as e:
        log.warning("Alpha Vantage price for %s failed: %s", ticker_symbol, e)
        return None

    quote = data.get("Global Quote") or {}
    price = quote.get("05. price") or quote.get("08. previous close")
    if not price:
        # Rate limits come back as 200 with a "Note" / "Information" message
        note = data.get("Note") or data.get("Information") or "no quote returned"
        log.warning("Alpha Vantage had no price for %s: %s", ticker_symbol, str(note)[:120])
        return None
    try:
        return float(price)
    except ValueError:
        return None


def _yahoo_price(ticker_symbol: str) -> float | None:
    try:
        tk = yf.Ticker(ticker_symbol)
        try:
            price = tk.fast_info["last_price"]
        except Exception:
            price = None
        if not price:
            hist = tk.history(period="5d")
            price = float(hist["Close"].dropna().iloc[-1]) if not hist.empty else None
        return float(price) if price and float(price) > 0 else None
    except Exception as e:
        log.warning("Yahoo price for %s failed: %s", ticker_symbol, e)
        return None


def get_current_price(ticker_symbol: str) -> float | None:
    """Latest stock price, or None if neither source has one."""
    def fetch():
        return _alpha_vantage_price(ticker_symbol) or _yahoo_price(ticker_symbol)
    return cached(("price", ticker_symbol), PRICE_TTL, fetch)


def _as_date(v) -> date | None:
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    try:
        return date.fromisoformat(str(v)[:10])
    except ValueError:
        return None


def get_events(ticker_symbol: str) -> dict:
    """
    Upcoming earnings and ex-dividend dates (YYYY-MM-DD, or None when there's
    no upcoming one or Yahoo doesn't know). Never raises.
    """
    def fetch():
        try:
            cal = yf.Ticker(ticker_symbol).calendar or {}
        except Exception as e:
            log.warning("Yahoo calendar for %s failed: %s", ticker_symbol, e)
            return None
        if not isinstance(cal, dict):
            return None
        today = date.today()
        earnings = cal.get("Earnings Date")
        earnings = earnings if isinstance(earnings, (list, tuple)) else [earnings]
        upcoming = sorted(d for d in (_as_date(e) for e in earnings) if d and d >= today)
        ex_div = _as_date(cal.get("Ex-Dividend Date"))
        return {
            "earnings_date": upcoming[0].isoformat() if upcoming else None,
            "ex_dividend_date": ex_div.isoformat() if ex_div and ex_div >= today else None,
        }
    return cached(("events", ticker_symbol), EVENTS_TTL, fetch) or {"earnings_date": None, "ex_dividend_date": None}


def get_close_on(ticker_symbol: str, day: str) -> float | None:
    """The stock's closing price on a past trading day (YYYY-MM-DD), or None."""
    def fetch():
        try:
            start = date.fromisoformat(day)
            hist = yf.Ticker(ticker_symbol).history(start=start.isoformat(), end=(start + timedelta(days=1)).isoformat())
            closes = hist["Close"].dropna() if not hist.empty else []
            return float(closes.iloc[-1]) if len(closes) else None
        except Exception as e:
            log.warning("Yahoo close for %s on %s failed: %s", ticker_symbol, day, e)
            return None
    return cached(("close", ticker_symbol, day), CLOSE_TTL, fetch)


def get_recent_closes(ticker_symbol: str) -> list[float] | None:
    """Daily closing prices for about the last three months, oldest first, or None."""
    def fetch():
        try:
            hist = yf.Ticker(ticker_symbol).history(period="3mo")
            closes = hist["Close"].dropna() if not hist.empty else []
            return [float(c) for c in closes] or None
        except Exception as e:
            log.warning("Yahoo history for %s failed: %s", ticker_symbol, e)
            return None
    return cached(("history", ticker_symbol), HISTORY_TTL, fetch)
