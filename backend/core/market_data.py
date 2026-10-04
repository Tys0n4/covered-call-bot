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

from core import db
from core.cache import CLOSE_TTL, EVENTS_TTL, HISTORY_TTL, PRICE_TTL, RETRY_AFTER, cached
from core.market_hours import market_today

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


NO_EARNINGS = ("ETF", "MUTUALFUND", "INDEX")   # Yahoo quote types that never report earnings


def _yahoo_events(ticker_symbol: str) -> dict | None:
    """Yahoo's upcoming earnings / ex-dividend dates, or None when Yahoo didn't answer."""
    try:
        cal = yf.Ticker(ticker_symbol).calendar
    except Exception as e:
        log.warning("Yahoo calendar for %s failed: %s", ticker_symbol, e)
        return None
    # yfinance turns a blocked or rate-limited request into an empty calendar
    if not isinstance(cal, dict) or not cal:
        log.warning("Yahoo calendar for %s came back empty", ticker_symbol)
        return None
    today = date.fromisoformat(market_today())
    earnings = cal.get("Earnings Date")
    earnings = earnings if isinstance(earnings, (list, tuple)) else [earnings]
    upcoming = sorted(d for d in (_as_date(e) for e in earnings) if d and d >= today)
    ex_div = _as_date(cal.get("Ex-Dividend Date"))
    return {
        "earnings_date": upcoming[0].isoformat() if upcoming else None,
        "ex_dividend_date": ex_div.isoformat() if ex_div and ex_div >= today else None,
    }


def _save_events(ticker_symbol: str, events: dict) -> None:
    try:
        engine = db.get_engine()
        with engine.begin() as c:
            c.execute(db.known_events.delete().where(db.known_events.c.ticker == ticker_symbol))
            c.execute(db.known_events.insert().values(
                ticker=ticker_symbol, checked_at=datetime.now().isoformat(timespec="seconds"), **events))
    except Exception as e:
        log.warning("Saving %s's event dates failed: %s", ticker_symbol, e)


def _saved_events(ticker_symbol: str) -> dict | None:
    try:
        with db.get_engine().connect() as c:
            row = c.execute(db.known_events.select().where(db.known_events.c.ticker == ticker_symbol)).first()
    except Exception as e:
        log.warning("Reading %s's saved event dates failed: %s", ticker_symbol, e)
        return None
    return dict(row._mapping) if row else None


def get_events(ticker_symbol: str) -> dict:
    """
    Upcoming earnings and ex-dividend dates (YYYY-MM-DD, or None when there's
    no upcoming one). Never raises.

    Yahoo's answer is cached for a few hours and saved in the database. When
    Yahoo doesn't answer (rate limits, mostly), the saved dates are used while
    they're still ahead and Yahoo is asked again after a few minutes. With no
    saved earnings date ahead, earnings_unknown is True so the app can say so.
    """
    def fetch():
        found = _yahoo_events(ticker_symbol)
        if found is not None:
            _save_events(ticker_symbol, found)
        return found

    found = cached(("events", ticker_symbol), EVENTS_TTL, fetch, retry_after=RETRY_AFTER)
    if found is not None:
        return {**found, "earnings_unknown": False}

    today = market_today()
    saved = _saved_events(ticker_symbol) or {}
    ahead = {k: saved.get(k) if (saved.get(k) or "") >= today else None for k in ("earnings_date", "ex_dividend_date")}
    if ahead["earnings_date"]:
        unknown = False
    elif saved and saved.get("earnings_date") is None:
        unknown = False   # Yahoo's last answer: no earnings scheduled
    else:
        unknown = get_info(ticker_symbol).get("quoteType") not in NO_EARNINGS
    return {**ahead, "earnings_unknown": unknown}


INFO_TTL = 24 * 3600


def get_info(ticker_symbol: str) -> dict:
    """Yahoo's company profile (industry, dividend rate, ...), cached for a day. Never raises."""
    def fetch():
        try:
            info = dict(yf.Ticker(ticker_symbol).info or {})
        except Exception as e:
            log.warning("Yahoo info for %s failed: %s", ticker_symbol, e)
            return None
        return info or None   # empty = Yahoo didn't answer; ask again later instead of keeping it a day
    return cached(("info", ticker_symbol), INFO_TTL, fetch, retry_after=RETRY_AFTER) or {}


def get_dividend_yield(ticker_symbol: str, stock_price: float) -> float:
    """Yearly dividend as a share of the price (0.0 when none or unknown)."""
    try:
        rate = float(get_info(ticker_symbol).get("dividendRate") or 0)
    except (TypeError, ValueError):
        return 0.0
    return rate / stock_price if rate > 0 and stock_price > 0 else 0.0


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
