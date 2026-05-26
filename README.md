# Covered Call Scanner

A full-stack financial tool for scanning, planning, and managing covered call options positions. Built with Python (FastAPI) and React.

**Developed by Thai Nguyen** · [GitHub](https://github.com/Tys0n4)

---

## Overview

Covered Call Scanner automates the process of finding, evaluating, and tracking covered call opportunities for stock positions you already own. Instead of manually scanning options chains, the app fetches live market data, scores candidates by income potential and risk profile, and builds a contract allocation plan that maintains a configurable 70/30 income-to-balanced split across your portfolio.

---

## Features

- **Live options scanning** — fetches real-time options chains via yfinance and Alpha Vantage
- **Candidate scoring** — ranks options by annualized yield, delta proximity, bid-ask spread quality, and volume
- **Smart allocation** — maintains a 70/30 income/balanced contract split per ticker, accounting for already-open positions
- **Position management** — tracks open covered call positions and evaluates buyback opportunities based on profit capture %
- **Multi-ticker support** — manage covered calls across multiple stock positions independently
- **REST API** — FastAPI backend with auto-generated interactive docs at `/docs`
- **React dashboard** — dark-themed UI with per-ticker breakdown cards, allocation bar, and candidate tables

---

## Tech Stack

| Layer     | Technology                          |
|-----------|-------------------------------------|
| Backend   | Python, FastAPI, Uvicorn            |
| Data      | yfinance, Alpha Vantage API, pandas |
| Frontend  | React, Vite, Tailwind CSS           |
| State     | React Context API, localStorage     |
| Persistence | JSON flat-file store              |

---

## Project Structure

```
covered-call-bot/
├── app/                    # Core Python logic
│   ├── scanner_service.py  # Full scan pipeline
│   ├── planning_service.py # Contract allocation with 70/30 rule
│   ├── management.py       # Buyback evaluation
│   ├── positions_store.py  # JSON position persistence
│   ├── scoring.py          # Income + balanced scoring
│   ├── filters.py          # Quote quality + liquidity filters
│   ├── calculations.py     # Annualized yield, spread metrics
│   ├── greeks.py           # Black-Scholes delta estimation
│   ├── config.py           # Central strategy config (all constants)
│   ├── models.py           # Dataclasses for core domain objects
│   └── data/
│       ├── portfolio.csv
│       └── open_positions.json
├── api/                    # FastAPI backend
│   ├── main.py             # App entry + CORS
│   ├── schemas.py          # Pydantic request/response models
│   └── routes/
│       ├── scan.py         # POST /scan
│       ├── positions.py    # GET/POST /positions
│       ├── manage.py       # GET /manage
│       ├── portfolio.py    # GET /portfolio
│       └── settings.py     # GET /settings
└── web/                    # React frontend
    └── src/
        ├── context/        # TickerContext global state
        ├── components/     # Layout, sidebar
        └── pages/          # Dashboard, Scanner, Positions, Manage, Settings
```

---

## Getting Started

### Prerequisites

- Python 3.10+
- Node.js 22+
- Alpha Vantage API key (free at [alphavantage.co](https://www.alphavantage.co))

### 1. Clone the repo

```bash
git clone https://github.com/Tys0n4/covered-call-scanner.git
cd covered-call-scanner
```

### 2. Install Python dependencies

```bash
pip install fastapi uvicorn pydantic yfinance pandas requests python-dotenv
```

### 3. Set up environment variables

Create `app/.env`:

```
ALPHA_VANTAGE_KEY=your_key_here
```

### 4. Set up your portfolio

Create `app/data/portfolio.csv`:

```csv
ticker,shares,avg_cost
SOFI,1800,13.01
```

Create an empty `app/data/open_positions.json`:

```json
[]
```

### 5. Start the API

From the `covered-call-bot/` root directory:

```bash
uvicorn api.main:app --reload --port 8000
```

API docs available at [http://localhost:8000/docs](http://localhost:8000/docs)

### 6. Install and start the frontend

```bash
cd web
npm install
npm install axios react-router-dom recharts lucide-react
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

---

## How It Works

### Scanning

The scanner fetches the full options chain for a ticker within a configurable DTE (days to expiry) window. Each candidate is filtered by:

- Minimum strike % above current price (default 20% OTM)
- Minimum premium, volume, and open interest
- Maximum bid-ask spread as a % of mid price

Surviving candidates are scored on two dimensions:

- **Income score** — weighted by annualized yield and volume
- **Balanced score** — weighted by delta proximity to target (0.22), upside %, and annualized yield

### Allocation

The planner maintains a **70/30 income/balanced split** across the total available contracts from your shares. It reads existing open positions and calculates how many contracts of each type are still needed to reach the target — so it always plans the right amount regardless of what's already open.

### Management

The management module fetches the current ask price for each open position and calculates profit captured vs the original entry price. When profit capture reaches 80% (configurable), it flags the position for buyback.

---

## Configuration

All strategy constants live in `app/config.py`:

```python
@dataclass(frozen=True)
class ScannerConfig:
    min_dte: int = 20
    max_dte: int = 38
    min_strike_pct_above_current: float = 0.20
    min_premium: float = 0.05
    min_volume: int = 10
    min_open_interest: int = 50
    target_delta: float = 0.22
    income_weight: float = 0.70
    buyback_budget_pct: float = 0.15
    profit_capture_target_pct: float = 80.0
```

---

## API Endpoints

| Method | Endpoint         | Description                              |
|--------|------------------|------------------------------------------|
| GET    | `/portfolio`     | All tickers with contract stats          |
| POST   | `/scan`          | Run scanner for a ticker                 |
| POST   | `/scan/save`     | Save planned positions                   |
| GET    | `/positions`     | Open positions (filter by ticker)        |
| GET    | `/positions/all` | All positions including closed           |
| POST   | `/positions/close` | Mark a position as closed              |
| GET    | `/manage`        | Evaluate positions for buyback           |
| GET    | `/settings`      | Current scanner config                   |

---

## Screenshots

> Dashboard, Scanner, and Manage pages shown below.

*Add screenshots here after deployment.*

---

## License

MIT License — feel free to use, modify, and distribute.

---

*Built by Thai Nguyen · [github.com/Tys0n4](https://github.com/Tys0n4)*
