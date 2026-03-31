def create_position(
    ticker,
    expiry,
    strike,
    contracts,
    entry_price,
    premium_source="NONE",
    quote_quality="BAD",
    warning="Verify on broker",
):
    premium_total = contracts * entry_price * 100

    return {
        "ticker": ticker,
        "expiry": expiry,
        "strike": strike,
        "contracts": contracts,
        "entry_price": entry_price,
        "premium_total": round(premium_total, 2),
        "premium_source": premium_source,
        "quote_quality": quote_quality,
        "warning": warning,
        "status": "OPEN",
    }


def create_positions_from_plan(ticker, plan, scored_calls):
    positions = []

    for item in plan:
        expiry = item["expiry"]
        strike = item["strike"]
        contracts = item["contracts"]

        match = scored_calls[
            (scored_calls["expiry"] == expiry) &
            (scored_calls["strike"] == strike)
        ]

        if match.empty:
            raise ValueError(f"No scored option found for expiry {expiry} and strike {strike}")

        row = match.iloc[0]
        entry_price = float(row["premium_price"])

        position = create_position(
            ticker=ticker,
            expiry=expiry,
            strike=strike,
            contracts=contracts,
            entry_price=entry_price,
            premium_source=str(row.get("premium_source", "NONE")),
            quote_quality=str(row.get("quote_quality", "BAD")),
            warning=str(row.get("warning", "Verify on broker")),
        )

        positions.append(position)

    return positions