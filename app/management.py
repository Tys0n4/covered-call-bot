def calculate_profit_capture(entry_price, current_price):
    if entry_price <= 0:
        return 0.0

    return ((entry_price - current_price) / entry_price) * 100


def should_buy_back(entry_price, current_price, target_profit_pct=80):
    profit_capture = calculate_profit_capture(entry_price, current_price)
    return profit_capture >= target_profit_pct


def evaluate_position(position, current_option_price, target_profit_pct=80):
    entry_price = position["entry_price"]
    profit_capture = calculate_profit_capture(entry_price, current_option_price)
    buy_back = should_buy_back(entry_price, current_option_price, target_profit_pct)

    return {
        "ticker": position["ticker"],
        "expiry": position["expiry"],
        "strike": position["strike"],
        "contracts": position["contracts"],
        "entry_price": entry_price,
        "current_option_price": current_option_price,
        "profit_capture_pct": round(profit_capture, 2),
        "should_buy_back": buy_back
    }