# scoring.py
"""Monthly income per option, your delta range, and the two picks paced to your goal."""
import pandas as pd
from core.config import ScannerConfig

# Around an event (earnings, a Fed meeting, industry earnings) picks stay within
# this much of the bottom of your delta range
EVENT_DELTA_SLACK = 0.03
DAYS_PER_MONTH = 30.4


def add_monthly_income(df: pd.DataFrame, config: ScannerConfig, fee_per_contract: float = 0.0) -> pd.DataFrame:
    """
    What you expect to keep per contract per month, to compare expiries and pace
    the monthly goal: you buy back at your target (the earlier event target when
    earnings or a Fed decision comes before expiry), so you keep that share of
    the premium, minus the commission to sell and the one to buy back.
    """
    df = df.copy()
    kept = pd.Series(config.profit_capture_target_pct / 100, index=df.index)
    if "spans_earnings" in df.columns or "spans_fed" in df.columns:
        event = df.get("spans_earnings", False) | df.get("spans_fed", False)
        kept = kept.where(~event.astype(bool), min(config.event_buyback_pct, config.profit_capture_target_pct) / 100)
    expected = df["premium_per_contract"] * kept - 2 * fee_per_contract
    df["monthly_per_contract"] = (expected / df["dte"] * DAYS_PER_MONTH).round(2)
    return df


def in_delta_range(df: pd.DataFrame, config: ScannerConfig) -> pd.DataFrame:
    delta = pd.to_numeric(df["delta"], errors="coerce")
    return df[(delta >= config.delta_min) & (delta <= config.delta_max)]


def recent_prices_only(df: pd.DataFrame) -> pd.DataFrame:
    """Options priced by a trade from before the latest session (OLD) can't be trusted; skip them when others can."""
    if "quote_quality" not in df.columns:
        return df
    fresh = df[df["quote_quality"] != "OLD"]
    return fresh if not fresh.empty else df


def pick_for_strategy(df: pd.DataFrame, config: ScannerConfig, goal_pace: float = 0.0):
    """
    Pick (income, balanced, plan_per_contract) from options already in your delta range.

    balanced — the best payer near the bottom of your range (the safer end)
    income   — with a monthly goal: the LOWEST delta whose blend with the balanced
               pick (at your income/balanced split) earns goal_pace per contract per
               month, so it only takes the risk the goal needs. Without a goal, or
               when nothing in range gets there: the best payer in range.
    Expiries that span an event are capped near the bottom of the range.
    plan_per_contract is that blend's monthly income per contract.
    """
    if df.empty:
        return None, None, 0.0
    spans = df.get("spans_event", pd.Series(False, index=df.index)).fillna(False).astype(bool)
    cap = pd.Series(config.delta_max, index=df.index).where(~spans, min(config.delta_max, config.delta_min + EVENT_DELTA_SLACK))
    eligible = df[df["delta"] <= cap]
    if eligible.empty:
        return None, None, 0.0

    low_end = eligible[eligible["delta"] <= config.delta_min + EVENT_DELTA_SLACK]
    pool = low_end if not low_end.empty else eligible.nsmallest(1, "delta")
    balanced = pool.sort_values(["monthly_per_contract", "delta"], ascending=[False, True]).iloc[0]

    # Income is the higher-premium side: at least the balanced pick's delta and monthly income
    others = eligible[
        (eligible["delta"] >= balanced["delta"])
        & (eligible["monthly_per_contract"] >= balanced["monthly_per_contract"])
        & (eligible.index != balanced.name)
    ]
    if others.empty:
        others = eligible.loc[[balanced.name]]
    w = config.income_weight
    blend = others["monthly_per_contract"] * w + float(balanced["monthly_per_contract"]) * (1 - w)
    income = None
    if goal_pace > 0:
        meets = others[blend >= goal_pace]
        if not meets.empty:
            income = meets.sort_values(["delta", "monthly_per_contract"], ascending=[True, False]).iloc[0]
    if income is None:
        income = others.sort_values(["monthly_per_contract", "delta"], ascending=[False, True]).iloc[0]

    plan = float(income["monthly_per_contract"]) * w + float(balanced["monthly_per_contract"]) * (1 - w)
    return income, balanced, round(plan, 2)
