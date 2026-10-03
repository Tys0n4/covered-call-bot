# Covered Call Scanner

A full-stack financial tool for scanning, planning, and managing covered call options positions. Built with Python (FastAPI) and React.

**Developed by Thai Nguyen** · [GitHub](https://github.com/Tys0n4)

---

## Live Demo

**Frontend:** https://covered-call-bot.vercel.app  
**API Docs:** https://covered-call-bot-production.up.railway.app/docs

---

## Overview

Covered Call Scanner automates the process of finding, evaluating, and tracking covered call opportunities for stock positions you already own. Instead of manually scanning options chains, the app fetches live market data, scores candidates by income potential and risk profile, and builds a contract allocation plan that maintains a configurable 70/30 income-to-balanced split across your portfolio.

---

## Features

- **Live options scanning** — options chains from Yahoo Finance (yfinance); stock price from Alpha Vantage with an automatic Yahoo fallback; NYSE holidays and early closes handled
- **Candidate scoring** — ranks options by annualized yield, delta proximity, bid-ask spread quality, and volume
- **Smart allocation** — maintains a 70/30 income/balanced contract split per ticker, accounting for already-open positions
- **Position management** — tracks open covered call positions and evaluates buyback opportunities based on profit capture %
- **Buy-back alerts** — a Discord message when an open call reaches your buy-back target, checked every 15 minutes during market hours
- **Real fills and fees** — record the price your broker actually filled and your commissions when you sell, buy back or roll
- **Rolling** — buy back a call and sell a new one on the same shares in one step
- **Assignment tracking** — record shares called away (early or at expiry); calls that expired in the money are flagged for review
- **Earnings and ex-dividend warnings** — options whose expiry spans the next earnings or ex-dividend date are flagged, with an optional filter to skip earnings
- **Performance** — realized results by month, net after buybacks and fees, gains on shares called away, and yearly return on capital
- **Multi-ticker support** — manage covered calls across multiple stock positions independently
- **REST API** — FastAPI backend with auto-generated interactive docs at `/docs`
- **React app** — dark-themed, works on desktop and phones

---

## Screenshots

*Demo portfolio with simulated market data.*

**Dashboard** — a "Needs attention" list (calls to buy back, contracts to sell, calls expiring soon, your monthly goal), then one row per stock.

![Dashboard](docs/screenshots/dashboard.png)

**Scanner** — a recommended trade split into income and balanced calls, your actual fills, the two top picks, and warnings such as earnings before expiry.

![Scanner](docs/screenshots/scanner.png)

**Positions** — every open call across your stocks, with live prices checked automatically to show which are ready to buy back. Roll and Close sit on each card; Edit and Delete are in the ⋯ menu, and changes can be undone.

![Positions](docs/screenshots/positions.png)

**Roll a call** — buy back and sell a new call in one step, with the net credit or debit worked out.

![Roll a call](docs/screenshots/roll.png)

**Performance** — what you kept after buybacks and fees, yearly return on capital, gains on shares called away, and a month-by-month chart against your goal.

![Performance](docs/screenshots/performance.png)

**On a phone**

<img src="docs/screenshots/mobile.png" alt="Positions on a phone" width="320">

---

## Tech Stack

| Layer       | Technology                          |
|-------------|-------------------------------------|
| Backend     | Python, FastAPI, Uvicorn            |
| Data        | yfinance, Alpha Vantage API, pandas |
| Frontend    | React, Vite, Tailwind CSS           |
| State       | React Context API, localStorage     |
| Persistence | Postgres (SQLite locally), SQLAlchemy |
| Deployment  | Vercel (frontend), Railway (backend)|

---

## Project Structure

```
covered-call-bot/
├── backend/
│   ├── api/                  # FastAPI app: main.py (entry), auth.py, schemas.py
│   │   └── routes/           # portfolio, scan, positions, manage, performance, settings
│   ├── core/                 # Covered call logic (see core/__init__.py for a module map)
│   │   ├── scanner.py        # Scan pipeline: price, chain, filters, scoring, warnings
│   │   ├── planner.py        # Turns a scan into the trade to place, for your split
│   │   ├── positions.py      # Save, close, roll, assign, edit, undo, delete calls
│   │   ├── buyback.py        # "Check prices": time to buy back?
│   │   ├── assignment.py     # Expired calls that were probably assigned
│   │   ├── performance.py    # Realized results and return on capital
│   │   ├── market_data.py    # Stock price, earnings/ex-dividend dates
│   │   ├── options_data.py   # Option chains from Yahoo
│   │   ├── market_hours.py   # NYSE hours, holidays, early closes
│   │   ├── db.py             # Database tables (Postgres, or SQLite locally)
│   │   └── ...               # filters, quotes, calculations, greeks, scoring, strategy, ...
├── tests/                    # pytest suite (fake market, temporary database)
├── web/                      # React frontend (Vite), deployed to Vercel
│   └── src/
│       ├── pages/            # Dashboard, Scanner, Positions, Performance, Strategy, Login
│       ├── components/       # Shared UI (Layout, PageHeader, InfoTip, ...)
│       │   └── dialogs/      # Pop-up dialogs (add, close, roll, edit, holding)
│       ├── context/          # Login state and the selected stock
│       ├── api/client.js     # Calls to the backend
│       └── lib/              # Formatting, P&L and strategy helpers
├── docs/screenshots/
├── requirements.txt          # Backend dependencies (pinned)
├── railway.toml              # Railway start command
└── .github/workflows/ci.yml  # Tests, lint and build on every pull request
```

---

## Getting Started

### Prerequisites

- Python 3.11+
- Node.js 22+
- Alpha Vantage API key (free at [alphavantage.co](https://www.alphavantage.co))

### 1. Clone the repo

```bash
git clone https://github.com/Tys0n4/covered-call-bot.git
cd covered-call-bot
```

### 2. Install Python dependencies

```bash
pip install -r requirements.txt
```

### 3. Set up environment variables

Create `backend/.env` (used for local development):

```
ALPHA_VANTAGE_KEY=your_key_here
```

Server settings (set these on Railway, or export them locally):

| Variable          | What it does |
|-------------------|--------------|
| `APP_PASSWORD`    | Password for the app's login screen. **Set this on any server others can reach**; without it the API is open to anyone. Leave unset for local development. |
| `AUTH_SECRET`     | Optional. Key used to sign login tokens. Defaults to one derived from `APP_PASSWORD`, so changing the password logs everyone out. |
| `AUTH_TOKEN_DAYS` | Optional. How long a login lasts (default 30). |
| `DATABASE_URL`    | Postgres connection string. Leave unset to use a local SQLite file. |
| `APP_TIMEZONE`    | Time zone for trade dates (default `America/Edmonton`). |

### 4. Start the API

```bash
uvicorn api.main:app --app-dir backend --reload --port 8000
```

API docs available at [http://localhost:8000/docs](http://localhost:8000/docs)

Without `DATABASE_URL`, an empty local SQLite database is created at `backend/covcall.db`. Add your stocks from the Dashboard.

### 5. Install and start the frontend

```bash
cd web
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

---

## How It Works

### Scanning

The scanner fetches the full options chain for a ticker within a configurable DTE (days to expiry) window. Each candidate is filtered by:

- Minimum strike % above current price (default and lowest allowed: 15% OTM)
- Minimum premium, volume, and open interest
- Maximum bid-ask spread as a % of mid price

Surviving candidates are scored on two dimensions:

- **Income score** — weighted by annualized yield and volume
- **Balanced score** — weighted by delta proximity to a fixed 12% target, upside %, and annualized yield

### Allocation

The planner maintains a **70/30 income/balanced split** across the total available contracts from your shares. It reads existing open positions and calculates how many contracts of each type are still needed to reach the target — so it always plans the right amount regardless of what's already open.

### Management

The management module fetches the current ask price for each open position and calculates profit captured vs the original entry price. When profit capture reaches 80% (configurable), it flags the position for buyback.

From the Positions page you can close a call (bought back, with cost and fees), roll it into a new one, or record that your shares were called away. When a call expires with the stock above the strike, the app asks you to confirm whether it was assigned instead of assuming.

### Buy-back alerts (Discord)

When an open call reaches your buy-back target, the app can post a message to a Discord channel. Each call is alerted once.

1. **Discord:** in the channel you want, open *Edit Channel → Integrations → Webhooks → New Webhook* and copy the webhook URL.
2. **App:** paste it under *Buy-back alerts* on the Strategy page and click Connect. A test message is sent right away.
3. **GitHub:** the scheduled workflow `.github/workflows/alerts.yml` wakes the API every 15 minutes on weekdays and calls `POST /alerts/check`, which does nothing while the market is closed. If the API has a password, add it as a repository secret named `APP_PASSWORD` (*Settings → Secrets and variables → Actions*). Set a repository variable `API_URL` only if your backend isn't at `https://covered-call-bot-production.up.railway.app`.

You can run a check by hand from the Actions tab (*Buy-back alerts → Run workflow*) or with `cd backend && python -m core.alerts`. GitHub pauses scheduled workflows after 60 days without commits to the repository; re-enable it from the Actions tab if that happens.

### Performance

A call's result is realized when it finishes. Net = premium − fees − buyback cost. Assigned calls also record the gain or loss on the shares: (strike − your cost per share) × shares. Yearly return is net premium on the cost of the shares covered, weighted by how long each call was open. Bought-back calls with no cost entered are flagged and left out of the totals.

---

## Configuration

Scanner defaults live in `backend/core/config.py`; your split, buyback target, reserve and monthly goal are edited on the Strategy page:

```python
@dataclass(frozen=True)
class ScannerConfig:
    min_dte: int = 20
    max_dte: int = 38
    min_strike_pct_above_current: float = 0.15
    min_premium: float = 0.05
    min_volume: int = 10
    min_open_interest: int = 50
    target_delta: float = 0.12
    income_weight: float = 0.70
    buyback_budget_pct: float = 0.15
    profit_capture_target_pct: float = 80.0
```

---

## API Endpoints

When `APP_PASSWORD` is set, every endpoint except `/`, `/health` and `/auth/*`
needs an `Authorization: Bearer <token>` header (get a token from `/auth/login`).

| Method | Endpoint             | Description                                   |
|--------|----------------------|-----------------------------------------------|
| GET    | `/auth/status`       | Whether a password is required                |
| POST   | `/auth/login`        | Exchange the password for a login token       |
| GET    | `/portfolio`         | All tickers with contract stats               |
| POST   | `/portfolio`         | Add a stock you own                           |
| PUT    | `/portfolio/{ticker}`| Change shares / average cost                  |
| DELETE | `/portfolio/{ticker}`| Remove a stock (blocked while calls are open) |
| POST   | `/scan`              | Run scanner for a ticker in your portfolio    |
| POST   | `/scan/save`         | Save the recommended trade (checked against your shares and split) |
| GET    | `/positions`         | Open positions (filter by ticker)             |
| POST   | `/positions`         | Add a trade by hand (checked against your shares) |
| GET    | `/positions/all`     | All positions including closed                |
| POST   | `/positions/close`   | Mark a position as closed                     |
| POST   | `/positions/{id}/roll` | Buy back a call and sell a new one (one step) |
| POST   | `/positions/{id}/assign` | Record shares called away (removes them from the holding) |
| POST   | `/positions/{id}/not-assigned` | Confirm an in-the-money expiry was not assigned |
| GET    | `/positions/assignment-review` | Expired calls that probably got assigned |
| GET    | `/manage`            | Evaluate positions for buyback                |
| GET    | `/performance`       | Realized results: summary, months, every finished call |
| GET    | `/settings`          | Your saved strategy                           |
| PUT    | `/settings`          | Save your strategy                            |
| GET    | `/alerts`            | Buy-back alert settings (the webhook is never returned in full) |
| PUT    | `/alerts`            | Save the Discord webhook, turn alerts on/off, or remove the webhook |
| POST   | `/alerts/test`       | Send a test message to Discord                |
| POST   | `/alerts/check`      | Alert any open call that just reached the target (used by the scheduled workflow) |

---

## Tests

```bash
pip install -r requirements-dev.txt
pytest
ruff check backend tests
cd web && npm run lint && npm run build
```

GitHub Actions runs the same checks on every pull request and on pushes to `main` (`.github/workflows/ci.yml`).

The tests use a fake market and a temporary SQLite database, so they need no API keys or network.

---

## License

MIT License — feel free to use, modify, and distribute.

---

*Built by Thai Nguyen · [github.com/Tys0n4](https://github.com/Tys0n4)*
