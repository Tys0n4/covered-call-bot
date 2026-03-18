import yfinance as yf


def get_current_price(ticker_symbol):
    ticker = yf.Ticker(ticker_symbol)
    history = ticker.history(period="1d")

    if history.empty:
        return None

    current_price = history["Close"].iloc[-1]
    return float(current_price)