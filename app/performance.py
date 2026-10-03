# performance.py
"""
What your covered calls actually made.

A call's result is realized when it finishes: bought back (CLOSED), expired
worthless (EXPIRED) or exercised (ASSIGNED).

  option net   = premium - fees - buyback cost
  share gain   = (strike - your cost per share) x shares, for assigned calls
  capital      = your cost per share x shares the call covered
  return       = option net / capital, and per year: x 365 / days held

A bought-back call with no buyback cost entered has an unknown result; it is
counted separately and left out of the totals rather than guessed at.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date

FINISHED = ("CLOSED", "EXPIRED", "ASSIGNED")


def _n(v) -> float:
    return float(v) if v is not None else 0.0


def _days_held(p: dict) -> int:
    try:
        return max((date.fromisoformat(p["closed_at"][:10]) - date.fromisoformat(p["opened_at"][:10])).days, 1)
    except (TypeError, ValueError, KeyError):
        return 1


def trade_result(p: dict, avg_costs: dict[str, float]) -> dict:
    """Result of one finished call. avg_costs: today's avg cost per ticker, used when the call has none recorded."""
    known = not (p["status"] == "CLOSED" and p.get("close_cost") is None)
    fees = _n(p.get("open_fees")) + _n(p.get("close_fees"))
    option_net = _n(p["premium_total"]) - fees - _n(p.get("close_cost")) if known else None

    basis = p.get("cost_basis") or avg_costs.get(p["ticker"]) or None
    shares = int(p["contracts"]) * 100
    capital = (basis or float(p["strike"])) * shares
    days = _days_held(p)

    share_gain = None
    if p["status"] == "ASSIGNED" and basis:
        share_gain = round((float(p["strike"]) - basis) * shares, 2)

    return_pct = option_net / capital * 100 if option_net is not None and capital > 0 else None
    return {
        "id": p["id"],
        "ticker": p["ticker"],
        "status": p["status"],
        "allocation_type": p.get("allocation_type", ""),
        "strike": float(p["strike"]),
        "expiry": p["expiry"],
        "contracts": int(p["contracts"]),
        "opened_at": p["opened_at"],
        "closed_at": p.get("closed_at"),
        "rolled": False,
        "premium": round(_n(p["premium_total"]), 2),
        "buyback": round(_n(p.get("close_cost")), 2) if known else None,
        "fees": round(fees, 2),
        "option_net": round(option_net, 2) if option_net is not None else None,
        "share_gain": share_gain,
        "capital": round(capital, 2),
        "days_held": days,
        "return_pct": round(return_pct, 2) if return_pct is not None else None,
        "annualized_pct": round(return_pct * 365 / days, 1) if return_pct is not None else None,
    }


def compute_performance(positions: list[dict], avg_costs: dict[str, float], today: str) -> dict:
    """Summary, month-by-month results and every finished trade (newest first)."""
    rolled_ids = {p["rolled_from"] for p in positions if p.get("rolled_from")}
    trades = []
    for p in positions:
        if p["status"] in FINISHED and p.get("closed_at"):
            t = trade_result(p, avg_costs)
            t["rolled"] = p["id"] in rolled_ids
            trades.append(t)
    trades.sort(key=lambda t: (t["closed_at"], t["id"]), reverse=True)
    known = [t for t in trades if t["option_net"] is not None]

    months: dict[str, dict] = defaultdict(lambda: {
        "calls": 0, "premium": 0.0, "buybacks": 0.0, "fees": 0.0, "option_net": 0.0,
        "share_gains": 0.0, "missing_costs": 0,
    })
    for t in trades:
        m = months[t["closed_at"][:7]]
        m["calls"] += 1
        m["premium"] += t["premium"]
        m["fees"] += t["fees"]
        m["share_gains"] += t["share_gain"] or 0.0
        if t["option_net"] is None:      # kept is unknown without the buyback cost
            m["missing_costs"] += 1
            continue
        m["buybacks"] += t["buyback"] or 0.0
        m["option_net"] += t["option_net"]
    month_rows = [
        {"month": k, **{f: (round(v, 2) if isinstance(v, float) else v) for f, v in m.items()}}
        for k, m in sorted(months.items(), reverse=True)
    ]

    def realized(prefix: str = "") -> float:
        return round(sum(t["option_net"] for t in known if t["closed_at"].startswith(prefix)), 2)

    # Capital-weighted yearly return: total net / (capital x years it was tied up)
    capital_years = sum(t["capital"] * t["days_held"] / 365 for t in known)
    open_calls = [p for p in positions if p["status"] == "OPEN"]

    return {
        "summary": {
            "realized_this_month": realized(today[:7]),
            "realized_this_year": realized(today[:4]),
            "realized_all_time": realized(),
            "share_gains_all_time": round(sum(t["share_gain"] or 0 for t in trades), 2),
            "annualized_return_pct": round(sum(t["option_net"] for t in known) / capital_years * 100, 1) if capital_years else None,
            "win_rate_pct": round(sum(1 for t in known if t["option_net"] > 0) / len(known) * 100, 1) if known else None,
            "calls_finished": len(trades),
            "missing_costs": len(trades) - len(known),
            "open_calls": len(open_calls),
            "open_premium": round(sum(_n(p["premium_total"]) - _n(p.get("open_fees")) for p in open_calls), 2),
        },
        "months": month_rows,
        "trades": trades,
    }
