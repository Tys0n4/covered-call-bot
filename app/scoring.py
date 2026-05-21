# scoring.py
import pandas as pd
from config import ScannerConfig, DEFAULT_CONFIG

_DELTA_PENALTY = 0.0


def _safe_delta_balance(delta, target: float) -> float:
    """
    Returns a [0,1] score for proximity to target delta.
    Returns 0.0 when delta is missing — explicit penalty, not silent degradation.
    """
    if delta is None or (isinstance(delta, float) and pd.isna(delta)):
        return _DELTA_PENALTY
    try:
        raw = 1 - abs(float(delta) - target) / target
        return max(raw, 0.0)
    except (TypeError, ZeroDivisionError):
        return _DELTA_PENALTY


def score_options(df: pd.DataFrame, config: ScannerConfig = DEFAULT_CONFIG) -> pd.DataFrame:
    df = df.copy()

    def _safe_max(series, fallback=1.0) -> float:
        m = series.max()
        return m if m and m != 0 else fallback

    # Use annualized yield for fairer cross-DTE comparison
    yield_col = "annualized_yield_pct" if "annualized_yield_pct" in df.columns else "premium_yield_pct"

    max_yield = _safe_max(df[yield_col])
    max_upside = _safe_max(df["upside_to_strike_pct"])
    max_volume = _safe_max(df["volume"])

    df["yield_score"] = df[yield_col] / max_yield
    df["upside_score"] = df["upside_to_strike_pct"] / max_upside
    df["volume_score"] = df["volume"] / max_volume

    # Income: highest annualized yield, weighted by volume/liquidity
    df["income_score"] = (
        df["yield_score"] * config.income_yield_weight +
        df["volume_score"] * config.income_volume_weight
    )

    # Balanced: rewards delta near target, with upside and yield secondary
    df["delta_balance_score"] = df["delta"].apply(
        lambda d: _safe_delta_balance(d, target=config.target_delta)
    )

    df["balanced_score"] = (
        df["yield_score"] * config.balanced_yield_weight +
        df["upside_score"] * config.balanced_upside_weight +
        df["delta_balance_score"] * config.balanced_delta_weight
    )

    return df


def pick_best_options(df: pd.DataFrame):
    """Returns (income_pick, balanced_pick). Always different rows when possible."""
    if df.empty:
        return None, None

    income_pick = df.loc[df["income_score"].idxmax()]
    balanced_pool = df.drop(index=income_pick.name) if len(df) > 1 else df
    balanced_pick = balanced_pool.loc[balanced_pool["balanced_score"].idxmax()]

    return income_pick, balanced_pick
