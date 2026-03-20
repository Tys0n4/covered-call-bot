def get_total_contracts(total_shares):
    return total_shares // 100


def allocate_manual(total_shares, expiry, allocations):
    total_contracts = get_total_contracts(total_shares)

    used_contracts = sum(item["contracts"] for item in allocations)

    if used_contracts > total_contracts:
        raise ValueError("Allocated contracts exceed available covered call contracts.")

    plan = []
    for item in allocations:
        plan.append({
            "expiry": expiry,
            "strike": item["strike"],
            "contracts": item["contracts"]
        })

    return plan


def allocate_two_strikes(total_shares, expiry, first_strike, second_strike, first_weight=0.5):
    total_contracts = get_total_contracts(total_shares)

    first_contracts = int(total_contracts * first_weight)
    second_contracts = total_contracts - first_contracts

    plan = [
        {
            "expiry": expiry,
            "strike": first_strike,
            "contracts": first_contracts
        },
        {
            "expiry": expiry,
            "strike": second_strike,
            "contracts": second_contracts
        }
    ]

    return plan