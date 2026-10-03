# api/routes/portfolio.py
from fastapi import APIRouter, HTTPException

from core.portfolio import load_portfolio, upsert_holding, delete_holding, normalize_ticker
from core.positions import load_open_positions
from core.strategy import load_strategy, split_contracts
from api.schemas import HoldingIn, HoldingUpdate
from core.ticker_check import has_listed_options

router = APIRouter(prefix="/portfolio", tags=["portfolio"])


def _portfolio_rows() -> list[dict]:
    """All holdings with contract stats, as used by the dashboard and ticker selector."""
    positions = load_portfolio()
    open_positions = load_open_positions()
    income_weight = load_strategy()["income_weight"]

    result = []
    for pos in positions:
        total_contracts = pos.shares // 100
        target_income, target_balanced = split_contracts(total_contracts, income_weight)

        open_income = sum(
            p["contracts"] for p in open_positions
            if p.get("status") == "OPEN"
            and p.get("ticker") == pos.ticker
            and p.get("allocation_type") == "Income"
        )
        open_balanced = sum(
            p["contracts"] for p in open_positions
            if p.get("status") == "OPEN"
            and p.get("ticker") == pos.ticker
            and p.get("allocation_type") == "Balanced"
        )
        open_total    = open_income + open_balanced
        available     = max(total_contracts - open_total, 0)
        gross_premium = sum(
            p["premium_total"] for p in open_positions
            if p.get("status") == "OPEN"
            and p.get("ticker") == pos.ticker
        )

        result.append({
            "ticker":          pos.ticker,
            "shares":          pos.shares,
            "avg_cost":        pos.avg_cost,
            "total_contracts": total_contracts,
            "target_income":   target_income,
            "target_balanced": target_balanced,
            "open_income":     open_income,
            "open_balanced":   open_balanced,
            "open_total":      open_total,
            "available":       available,
            "gross_premium":   round(gross_premium, 2),
        })

    return result


def _open_contracts(ticker: str) -> int:
    return sum(
        p["contracts"] for p in load_open_positions()
        if p.get("status") == "OPEN" and p.get("ticker") == ticker
    )


def _valid_ticker(ticker: str) -> str:
    try:
        return normalize_ticker(ticker)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e


def _check_covers_open_calls(ticker: str, shares: int) -> None:
    """Refuse share counts that would leave already-sold calls uncovered."""
    open_contracts = _open_contracts(ticker)
    if shares // 100 < open_contracts:
        raise HTTPException(
            status_code=409,
            detail=(
                f"You have {open_contracts} open call contract(s) on {ticker}, which need at least "
                f"{open_contracts * 100} shares. Close those calls first or keep more shares."
            ),
        )


# Handlers are plain `def` so FastAPI runs them in a worker thread; their
# database and network calls would otherwise block every other request.

@router.get("")
def get_portfolio():
    """
    Return all tickers in the portfolio with contract stats.
    Used by the frontend ticker selector and dashboard.
    """
    return _portfolio_rows()


@router.post("", status_code=201)
def add_holding(holding: HoldingIn):
    """Add a stock you own. Fails if the ticker is already in the portfolio (use PUT to edit)."""
    ticker = _valid_ticker(holding.ticker)
    if any(p.ticker == ticker for p in load_portfolio()):
        raise HTTPException(status_code=409, detail=f"{ticker} is already in your portfolio. Edit it instead.")
    # Covered calls need listed options; catch typos like "SOFII" here
    if has_listed_options(ticker) is False:
        raise HTTPException(
            status_code=422,
            detail=f"Couldn't find listed options for {ticker}. Check the ticker symbol is right.",
        )
    upsert_holding(ticker, holding.shares, holding.avg_cost)
    return _portfolio_rows()


@router.put("/{ticker}")
def update_holding(ticker: str, update: HoldingUpdate):
    """Change the share count or average cost of a stock you own."""
    t = _valid_ticker(ticker)
    if not any(p.ticker == t for p in load_portfolio()):
        raise HTTPException(status_code=404, detail=f"{t} is not in your portfolio.")
    _check_covers_open_calls(t, update.shares)
    upsert_holding(t, update.shares, update.avg_cost)
    return _portfolio_rows()


@router.delete("/{ticker}")
def remove_holding(ticker: str):
    """Remove a stock from the portfolio. Blocked while it still has open calls."""
    t = _valid_ticker(ticker)
    open_contracts = _open_contracts(t)
    if open_contracts:
        raise HTTPException(
            status_code=409,
            detail=f"{t} still has {open_contracts} open call contract(s). Close them on the Positions page first.",
        )
    if not delete_holding(t):
        raise HTTPException(status_code=404, detail=f"{t} is not in your portfolio.")
    return _portfolio_rows()
