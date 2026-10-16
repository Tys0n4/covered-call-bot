// The buy-back price, checked against the same cases as the API
// (tests/fixtures/shared_rules.json), so the two can't drift apart
import { describe, expect, it } from 'vitest'
import rules from '../../../tests/fixtures/shared_rules.json'
import { buybackPrice } from './strategy'

describe('buybackPrice matches the API', () => {
  it.each(rules.buyback_prices)('sold at $$entry, $target% kept', ({ entry, target, price }) => {
    expect(buybackPrice(entry, target)).toBe(price)
  })
})
