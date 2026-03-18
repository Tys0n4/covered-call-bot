def score_options(df):
    df = df.copy()

    max_yield = df["premium_yield_pct"].max()
    max_upside = df["upside_to_strike_pct"].max()
    max_volume = df["volume"].max()

    if max_yield == 0:
        max_yield = 1
    if max_upside == 0:
        max_upside = 1
    if max_volume == 0:
        max_volume = 1

    df["yield_score"] = df["premium_yield_pct"] / max_yield
    df["upside_score"] = df["upside_to_strike_pct"] / max_upside
    df["volume_score"] = df["volume"] / max_volume

    # Income = highest premium/yield
    df["income_score"] = (
        df["yield_score"] * 0.75 +
        df["volume_score"] * 0.25
    )

    # Balanced = reward middle deltas more than highest premium
    # target around 0.10 to 0.18 for your current SOFI chains
    target_delta = 0.14
    df["delta_balance_score"] = 1 - (df["delta"] - target_delta).abs() / target_delta
    df["delta_balance_score"] = df["delta_balance_score"].clip(lower=0)

    df["balanced_score"] = (
        df["yield_score"] * 0.35 +
        df["upside_score"] * 0.35 +
        df["delta_balance_score"] * 0.30
    )

    # Safe = low delta + high upside
    df["safe_score"] = (
        (1 - df["delta"].fillna(0)) * 0.65 +
        df["upside_score"] * 0.25 +
        df["volume_score"] * 0.10
    )

    return df


def pick_best_options(df):
    if df.empty:
        return None, None, None

    income_pick = df.loc[df["income_score"].idxmax()]

    # For balanced, exclude the income pick if there are other choices
    balanced_pool = df.copy()
    if len(balanced_pool) > 1:
        balanced_pool = balanced_pool.drop(index=income_pick.name)

    balanced_pick = balanced_pool.loc[balanced_pool["balanced_score"].idxmax()]

    safe_pick = df.loc[df["safe_score"].idxmax()]

    return income_pick, balanced_pick, safe_pick