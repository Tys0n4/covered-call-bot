import { describe, expect, it } from 'vitest'
import {
  againstYou, cleanMoney, contractsTotal, keptPct, moneyValue, optionNet, resultLabel, totalFees, usualFees,
} from './pnl'

describe('optionNet', () => {
  it('is premium minus fees and the buyback', () => {
    expect(optionNet({ status: 'CLOSED', premium_total: 200, open_fees: 1.3, close_cost: 50, close_fees: 1.3 })).toBeCloseTo(147.4)
  })
  it('is unknown for a buyback with no cost entered', () => {
    expect(optionNet({ status: 'CLOSED', premium_total: 200, close_cost: null })).toBeNull()
  })
  it('keeps the whole premium when a call expires', () => {
    expect(optionNet({ status: 'EXPIRED', premium_total: 200, close_cost: 0 })).toBe(200)
  })
})

it('totalFees adds both sides', () => {
  expect(totalFees({ open_fees: 0.65, close_fees: null })).toBe(0.65)
})

it('resultLabel tells rolls from buybacks', () => {
  const rolled = new Set([7])
  expect(resultLabel({ id: 7, status: 'CLOSED' }, rolled)).toBe('Rolled')
  expect(resultLabel({ id: 8, status: 'CLOSED' }, rolled)).toBe('Bought back')
  expect(resultLabel({ id: 9, status: 'ASSIGNED' }, rolled)).toBe('Assigned')
})

it('keptPct rounds down, so 64.6% never reads as a 65% target', () => {
  expect(keptPct(64.6)).toBe(64)
  expect(keptPct(65)).toBe(65)
})

describe('money boxes', () => {
  it('cleanMoney keeps digits, one dot and two decimals', () => {
    expect(cleanMoney('$1,2.345')).toBe('12.34')
    expect(cleanMoney('007')).toBe('7')
    expect(cleanMoney('0.5')).toBe('0.5')
  })
  it('moneyValue treats an empty box as nothing', () => {
    expect(moneyValue('')).toBeNull()
    expect(moneyValue('.')).toBeNull()
    expect(moneyValue('1.5')).toBe(1.5)
  })
  it('contractsTotal is per share × 100 × contracts, to the cent', () => {
    expect(contractsTotal(0.57, 2)).toBe(114)
    expect(contractsTotal(1.005, 3)).toBe(301.5)
  })
  it('usualFees is empty at $0', () => {
    expect(usualFees({ commission_per_contract: 0 }, 3)).toBe('')
    expect(usualFees({ commission_per_contract: 0.65 }, 3)).toBe('1.95')
  })
})

describe('againstYou', () => {
  const call = { strike: 110, contracts: 2, entry_price: 1.35, premium_total: 270, open_fees: 0 }
  it('is nothing while the call costs less than it sold for', () => {
    expect(againstYou(call, { current_option_price: 1.0, stock_price: 105, cost_to_close: 200 }, 96.5)).toBeNull()
  })
  it('works out both choices in dollars', () => {
    const a = againstYou(call, { current_option_price: 5.4, stock_price: 114.2, cost_to_close: 1080 }, 96.5)
    expect(a.aboveStrike).toBe(true)
    expect(a.buybackPL).toBeCloseTo(270 - 1080)
    expect(a.calledPL).toBeCloseTo(270 + (110 - 96.5) * 200)
    expect(a.upsideGiven).toBeCloseTo((114.2 - 110) * 200)
  })
  it("can't total the called-away choice without your cost", () => {
    const a = againstYou(call, { current_option_price: 5.4, stock_price: 114.2, cost_to_close: 1080 }, null)
    expect(a.calledPL).toBeNull()
  })
})
