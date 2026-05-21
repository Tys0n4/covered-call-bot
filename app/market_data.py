# market_data.py
import os
import requests
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

ALPHA_VANTAGE_KEY = os.getenv("ALPHA_VANTAGE_KEY")
BASE_URL = "https://www.alphavantage.co/query"


def get_current_price(ticker_symbol: str) -> float | None:
    if not ALPHA_VANTAGE_KEY:
        print("ERROR: ALPHA_VANTAGE_KEY not found. Check your .env file is in the same folder as market_data.py.")
        return None
    """
    Fetch the latest price for a stock via Alpha Vantage GLOBAL_QUOTE.
    Uses 'price' (last trade) during hours, falls back to 'previous close' after hours.
    Costs 1 API call.
    """
    params = {
        "function": "GLOBAL_QUOTE",
        "symbol": ticker_symbol,
        "apikey": ALPHA_VANTAGE_KEY,
    }

    try:
        response = requests.get(BASE_URL, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()

        quote = data.get("Global Quote", {})

        price = quote.get("05. price") or quote.get("08. previous close")

        if not price:
            return None

        return float(price)

    except (requests.RequestException, ValueError, KeyError) as e:
        print(f"Error fetching price for {ticker_symbol}: {e}")
        return None
