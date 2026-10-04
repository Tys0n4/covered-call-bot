"""
Covered call logic, independent of the web API (backend/api uses it).

Scanning a stock
    scanner.py       the scan pipeline: price, option chain, filters, picks, warnings
    options_data.py  option chains and expiries from Yahoo
    market_data.py   stock price (Alpha Vantage, Yahoo fallback), earnings/ex-dividend dates, past closes
    events.py        Fed meeting dates, a stock's industry, earnings that move the industry
    filters.py       which options qualify (strike, premium, volume, open interest, spread)
    quotes.py        which price to use for an option (mid, last, ask)
    calculations.py  yields, upside and spread per option
    greeks.py        Black-Scholes delta
    scoring.py       monthly income, your delta range, the two picks paced to your monthly goal
    planner.py       turns a scan into the trade to place, for your split

Your calls and holdings
    positions.py     saving, closing, rolling, assigning, editing, undoing and deleting calls
    buyback.py       "Check prices": is it time to buy back?
    assignment.py    expired calls that were probably assigned
    performance.py   realized results and return on capital
    portfolio.py     your stock holdings
    strategy.py      your saved strategy and the income/balanced split math

Plumbing
    db.py            database tables (Postgres, or SQLite locally)
    config.py        scanner defaults
    models.py        shared dataclasses
    market_hours.py  NYSE hours, holidays and early closes
    cache.py         short in-memory cache for market data
    clock.py         "today" in your time zone
    ticker_check.py  does a ticker have listed options?
"""
