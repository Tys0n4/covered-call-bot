# tests/test_shared_rules.py — a rule the web app repeats in JavaScript (web/src/lib/strategy.js).
# Both sides are checked against tests/fixtures/shared_rules.json, so they can't drift apart.
import json
from pathlib import Path

import pytest

from core.buyback import buyback_price

RULES = json.loads((Path(__file__).parent / "fixtures" / "shared_rules.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("case", RULES["buyback_prices"], ids=lambda c: f"{c['entry']}@{c['target']}")
def test_buyback_price(case):
    assert buyback_price(case["entry"], case["target"]) == case["price"]
