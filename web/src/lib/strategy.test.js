// The buy-back price and the income/balanced split, checked against the same cases as the
// API (tests/fixtures/shared_rules.json), so the two can't drift apart
import { describe, expect, it } from 'vitest'
import rules from '../../../tests/fixtures/shared_rules.json'
import { buybackPrice, splitContracts } from './strategy'

describe('buybackPrice matches the API', () => {
  it.each(rules.buyback_prices)('sold at $$entry, $target% kept', ({ entry, target, price }) => {
    expect(buybackPrice(entry, target)).toBe(price)
  })
})

describe('splitContracts matches the API', () => {
  it.each(rules.splits)('$total contracts at $income_weight', ({ total, income_weight, income, balanced }) => {
    expect(splitContracts(total, income_weight)).toEqual([income, balanced])
  })
})
