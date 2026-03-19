def allocate_contracts(total_shares, allocations):
    total_contracts = total_shares // 100

    plan = []
    allocated = 0

    for i, allocation in enumerate(allocations):
        strike = allocation["strike"]
        weight = allocation["weight"]

        if i == len(allocations) - 1:
            contracts = total_contracts - allocated
        else:
            contracts = int(total_contracts * weight)
            allocated += contracts

        plan.append({
            "strike": strike,
            "contracts": contracts
        })

    return plan