# Covered Call Scanner

A full-stack financial tool for scanning, planning, and managing covered call options positions. Built with Python (FastAPI) and React.

**Developed by Thai Nguyen** · [GitHub](https://github.com/Tys0n4)

---

## Live Demo

**Frontend:** https://covered-call-bot.vercel.app  
**API Docs:** https://covered-call-bot-production.up.railway.app/docs

---

## Overview

Covered Call Scanner automates the process of finding, evaluating, and tracking covered call opportunities for stock positions you already own. Instead of manually scanning options chains, the app fetches live market data, picks calls within your chance-of-being-called range that keep you on pace for your monthly goal, and builds a contract allocation plan that maintains a configurable 70/30 income-to-balanced split across your portfolio.

---

## Features

- **Live options scanning** — options chains from Cboe's delayed quotes (about 15 minutes behind), with Yahoo Finance as the fallback; stock price from the same Cboe snapshot so it always matches the option prices, with Alpha Vantage and then Yahoo as fallbacks; NYSE holidays and early closes handled
- **Baseline strategy** — calls with a 20–30% chance of being called (delta 0.20–0.30), 14–30 days out, picked to reach your monthly goal with as little risk as possible; every part is editable on the Strategy page
- **Goal-paced picks** — compares options by the monthly income you expect to keep after buy-backs and fees, within your delta range
- **Smart allocation** — maintains a 70/30 income/balanced contract split per ticker, accounting for already-open positions
- **Position management** — tracks open covered call positions and evaluates buyback opportunities based on profit capture %
- **Buy-back alerts** — a Discord message when an open call reaches your buy-back target, checked every 15 minutes during market hours
- **Real fills** — record the price your broker actually filled when you sell, buy back or roll; set your broker's commission per contract on the Strategy page ($0 by default, and the fee boxes stay hidden at $0)
- **Rolling** — buy back a call and sell a new one on the same shares in one step
- **Assignment tracking** — record shares called away (early or at expiry); calls that expired in the money are flagged for review
- **Event awareness** — expiries that span earnings, a Fed rate decision, or earnings from the stock's industry leaders and your other stocks in the same industry are flagged, and picks lean to the safe end of your range; ex-dividend dates are flagged too
- **Performance** — realized results by month, net after buybacks and fees, gains on shares called away, and yearly return on capital
- **Multi-ticker support** — manage covered calls across multiple stock positions independently
- **REST API** — FastAPI backend with auto-generated interactive docs at `/docs`
- **React app** — dark-themed, works on desktop and phones. One meaning per color (cyan = action, green = money in, amber = heads up, red = loss, violet = Balanced); Syne for titles, Geist for text and Geist Mono for numbers, bundled with the app

---

## Screenshots

*Demo portfolio with simulated market data.*

**Dashboard** — your monthly goal as a ring (with premium in open calls and contracts working) next to the one thing to do next, anything else that needs you, and "Coming up": the next three events, earnings and Fed decisions first, with the rest of the month (expiries too) behind "Show more". Then one row per stock, with Edit shares or cost in its ⋯ menu.

![Dashboard](docs/screenshots/dashboard.png)

**Scanner** — one recommended trade: what you collect, the income and balanced calls with each one's chance of being called, whether it keeps you on pace for your monthly goal, and the price you actually sold at. A plain line says whether premiums are rich or thin right now, with the numbers behind it in the ⓘ; the buy-back reserve split and every option that matched are one tap away.

![Scanner](docs/screenshots/scanner.png)

**Positions** — every open call across your stocks, with prices checked automatically and grouped into **Ready to buy back**, **Going against you** and **Holding**. Calls that need something from you get the full card with the buy-back limit price and a Copy button; calls you're just holding are one line each (premium kept against the target) and open to the full card. Roll and Close sit on each card; Edit and Delete are in the ⋯ menu, and changes can be undone.

**Strategy** — your monthly goal, your broker's commission and Discord alerts first. The trading rules (chance of being called, expiry window, buy-back targets, split, reserve) start on recommended settings and show as a one-card summary; **Change rules** opens the controls.

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
| Data        | Cboe delayed quotes, yfinance, Alpha Vantage API, pandas |
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
│   │   └── routes/           # portfolio, scan, positions, manage, performance, settings, alerts, upcoming
│   ├── core/                 # Covered call logic (see core/__init__.py for a module map)
│   │   ├── scanner.py        # Scan pipeline: price, chain, filters, picks, warnings
│   │   ├── planner.py        # Turns a scan into the trade to place, for your split
│   │   ├── positions.py      # Save, close, roll, assign, edit, undo, delete calls
│   │   ├── buyback.py        # "Check prices": time to buy back?
│   │   ├── assignment.py     # Expired calls that were probably assigned
│   │   ├── performance.py    # Realized results and return on capital
│   │   ├── market_data.py    # Stock price, earnings/ex-dividend dates
│   │   ├── events.py         # Fed meeting dates, industry leaders, related earnings
│   │   ├── cboe.py           # Option chains from Cboe's delayed quotes
│   │   ├── options_data.py   # Option chains: Cboe, else Yahoo
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
- Alpha Vantage API key (optional, free at [alphavantage.co](https://www.alphavantage.co)): a backup stock price source when Cboe doesn't answer

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

The scanner fetches the options chain for a ticker within your expiry window (14–30 days by default). Each candidate is filtered by:

- Your delta range: the chance of being called, 20%–30% by default. This is the main risk rule.
- Minimum premium, volume, and open interest
- Optional minimum distance above the stock price (off by default; set it on the Scanner)
- Maximum bid-ask spread (35% of the mid price)

Each option is priced at the midpoint between the bid and the ask, where sell orders usually fill. Your broker's commission per contract (Strategy page, $0 by default) is subtracted, and yields are on what's left. Options that pay less than the commission are dropped.

Each scan also says whether premiums are **rich**, **normal** or **thin** right now: it compares the yearly move near-the-money options are priced for (implied volatility) with how much the stock actually moved over the last 20 trading days. Rich (implied at least 1.25× realized) is a good time to sell; thin (implied below realized) means you're paid less than the risk, and waiting may pay more.

From the options in your range the scanner picks two:

- **Balanced** — the best monthly income near the safe end of your range (within 3 points of your lowest delta).
- **Income** — the lowest-delta option that, blended with the balanced pick at your income/balanced split, reaches your monthly goal. Your goal is spread across every contract your holdings can cover, so each contract has a monthly pace to hit. If no option in range reaches it, the best payer is picked and the Scanner says you're short. With no goal set, the best payer in range is picked.

Monthly income is what you expect to keep per contract: the premium × your buy-back target (the earlier event target when earnings or a Fed decision comes first), minus the commission to sell and the one to buy back, ÷ days to expiry × 30.4. The goal check uses the same number, so "on pace" means after buy-backs.

**Option prices** come from Cboe's delayed quotes, about 15 minutes behind. When Cboe fails or has nothing for a stock, the app uses Yahoo Finance instead; Yahoo isn't used at all while Cboe works. The Scanner and the price check say which source was used. After the close, Cboe's closing bid and ask are used (at their midpoint) and marked as a closing quote. Because the quotes are 15 minutes behind, the first 15 minutes after the open are treated the same way: the feed still shows the last session's closing quotes, so the Scanner says so and keeps saving off until they catch up, and the buy-back alert check waits until then too.

**Chance of being called (delta)** is Cboe's own delta when Cboe supplies one. Otherwise it's Black-Scholes delta, lowered slightly for dividend payers. Its volatility comes from Yahoo's implied volatility; outside market hours Yahoo reports roughly zero there, so it's worked out from each option's own price instead, or from the stock's recent moves as a last resort. The Scanner says when it's using these estimates. A quiet strike whose last trade is from before the latest session is marked **Old price**: the stock has moved since, so that price doesn't set its volatility and the picks skip it.

**Events.** When earnings, a Fed rate decision (FOMC dates in `backend/core/events.py`), or earnings from the industry's largest companies or your other stocks in the same industry fall before an option's expiry, it's flagged and both picks stay within 3 points of your lowest delta. Industry comes from Yahoo Finance; the leaders list is in `backend/core/events.py`. Earnings and ex-dividend dates come from Yahoo and are saved in the database, so when Yahoo doesn't answer (it rate-limits cloud servers, often right after a redeploy) the saved dates are used until they pass, and Yahoo is asked again after 5 minutes. If there's no saved date either, the Dashboard and Scanner say the earnings date couldn't be checked instead of treating the stock as having none. Only confirmed Fed dates go there; when an expiry runs past the last one, the Scanner says the calendar ends there.

### Allocation

The planner maintains a **70/30 income/balanced split** across the total available contracts from your shares. It reads existing open positions and calculates how many contracts of each type are still needed to reach the target — so it always plans the right amount regardless of what's already open.

### Management

The management module prices each open call at what buying it back costs now: the midpoint between the bid and the ask, where buy orders usually fill, or the ask when there's no bid (a near-worthless call). It then calculates how much of the original premium you've kept. Each call gets one of three recommendations:

- **Buy back now**: the call's price (the midpoint) is at or below your **buy-back price**. That's your target share of the premium kept (85% by default) turned into a price per share: what you sold for × (1 − target), rounded to the closest cent, since options trade in whole cents. Sold at $0.34: 85% kept is $0.051, so the buy-back price is $0.05 (85.3% kept). Sold at $0.38: $0.057 rounds to $0.06 (84.2% kept), which is closer than $0.05. Half a cent rounds down, and it's never below $0.01. If earnings or a Fed decision comes before the call expires, the earlier event target applies (65% by default). Both targets are set on the Strategy page; Positions and the Discord alerts show the price to set as a limit order.
- **Let it expire**: past the target, but it expires within a week with the stock at least 5% below the strike and no event before expiry. Buying back would mostly pay the spread and commission for very little risk removed.
- **Keep holding**: not at the target yet.
- **When a call goes against you** (it now costs more than you sold it for), the card shows your two real choices in dollars instead: buy back now (the loss on the call; you keep your shares) or let it be called away at the strike (premium plus the gain or loss on your shares over your average cost). It's marked "Stock above strike" in red when the stock has passed the strike (the Dashboard lists these too), or "Call is up" in amber while it's still below.

Buyback costs include your usual commission. Discord alerts are only sent for "Buy back now".

Outside market hours there's no ask, so a call is priced at its last trade, unless that trade is from before the latest session (a quiet strike that hasn't traded for days). Then Positions shows "Price unavailable" with the last trade date instead of a recommendation, until the market opens.

From the Positions page you can close a call (bought back, with cost and fees), roll it into a new one, or record that your shares were called away. When a call expires with the stock above the strike, the app asks you to confirm whether it was assigned instead of assuming.

### Buy-back alerts (Discord)

When an open call reaches your buy-back target, the app can post a message to a Discord channel. Each call is alerted once.

1. **Discord:** in the channel you want, open *Edit Channel → Integrations → Webhooks → New Webhook* and copy the webhook URL.
2. **App:** paste it under *Buy-back alerts* on the Strategy page and click Connect. A test message is sent right away.
3. **Railway:** add a variable `ALERTS_KEY` set to a long random string (for example the output of `python -c "import secrets; print(secrets.token_urlsafe(32))"`). It lets a scheduler run the check without your password, and can do nothing else.
4. **[cron-job.org](https://cron-job.org)** (free): create a cron job that sends `POST https://covered-call-bot-production.up.railway.app/alerts/cron` with the header `X-Alerts-Key: <your ALERTS_KEY>`. Schedule: time zone *America/New_York*, Monday–Friday, hours 9–15, minutes 15 and 45 (every 30 minutes, 9:45 a.m. to 3:45 p.m.; the 9:15 call is skipped because prices are still the last session's). It answers right away and checks in the background.

GitHub's free scheduled workflows turned out too unreliable for this (one run in a whole trading day), so `.github/workflows/alerts.yml` now only runs by hand: *Actions → Buy-back alerts → Run workflow* (needs the `APP_PASSWORD` repository secret). You can also run a check with `cd backend && python -m core.alerts`.

### Performance

A call's result is realized when it finishes. Net = premium − fees − buyback cost.

The page opens with the honest bottom line: what selling calls added **compared with just holding the shares**. That's the premium kept, minus any gain given up when shares were called away below their market price that day (the stock's close on the assignment date minus the strike). Bought-back calls already include any rise in the stock in their buyback cost, and expired calls capped nothing.

 Assigned calls also record the gain or loss on the shares: (strike − your cost per share) × shares. Yearly return is net premium on the cost of the shares covered, weighted by how long each call was open. Bought-back calls with no cost entered are flagged and left out of the totals.

---

## Configuration

Defaults live in `backend/core/config.py`. Your delta range, expiry window, split, buy-back targets, reserve and monthly goal are edited on the Strategy page and override them:

```python
@dataclass(frozen=True)
class ScannerConfig:
    min_dte: int = 14
    max_dte: int = 30
    min_strike_pct_above_current: float = 0.0   # optional, off by default
    min_premium: float = 0.05
    min_volume: int = 10
    min_open_interest: int = 50
    delta_min: float = 0.20
    delta_max: float = 0.30
    income_weight: float = 0.70
    buyback_budget_pct: float = 0.15
    profit_capture_target_pct: float = 85.0
    event_buyback_pct: float = 65.0              # before earnings or a Fed decision
    commission_per_contract: float = 0.0         # your broker's, per option contract
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
| GET    | `/upcoming`          | Fed decisions and your holdings' earnings in the next 30 days (Dashboard) |
| GET    | `/settings`          | Your saved strategy                           |
| PUT    | `/settings`          | Save your strategy                            |
| GET    | `/alerts`            | Buy-back alert settings (the webhook is never returned in full) |
| PUT    | `/alerts`            | Save the Discord webhook, turn alerts on/off, or remove the webhook |
| POST   | `/alerts/test`       | Send a test message to Discord                |
| POST   | `/alerts/check`      | Alert any open call that just reached the target (the manual workflow) |
| POST   | `/alerts/cron`       | The same check for cron-job.org: no login, needs the `X-Alerts-Key` header (= `ALERTS_KEY`); answers 202 and checks in the background |

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
