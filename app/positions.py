def create_position(ticker, expiry, strike, contracts, entry_price):
    return {
        "ticker": ticker,
        "expiry": expiry,
        "strike": strike,
        "contracts": contracts,
        "entry_price": entry_price,
        "status": "OPEN"
    }


def create_positions_from_plan(ticker, expiry, plan, option_lookup):
    positions = []

    for item in plan:
        strike = item["strike"]
        contracts = item["contracts"]

        if strike not in option_lookup:
            raise ValueError(f"No option data found for strike {strike}")

        entry_price = option_lookup[strike]["premium_price"]

        position = create_position(
            ticker=ticker,
            expiry=expiry,
            strike=strike,
            contracts=contracts,
            entry_price=entry_price
        )

        positions.append(position)

    return positions