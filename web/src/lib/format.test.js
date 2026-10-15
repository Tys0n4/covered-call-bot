import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { daysUntil, fmtDate, marketToday, money, pct, plural, signedMoney, strike } from './format'

describe('money', () => {
  it('formats dollars and cents', () => {
    expect(money(1234.5)).toBe('$1,234.50')
    expect(money(1234.5, 0)).toBe('$1,235')
    expect(money(null)).toBe('—')
  })
  it('strike drops cents on whole dollars', () => {
    expect(strike(245)).toBe('$245')
    expect(strike(112.5)).toBe('$112.50')
  })
  it('signedMoney uses a real minus sign', () => {
    expect(signedMoney(613.05)).toBe('+$613.05')
    expect(signedMoney(-40)).toBe('−$40.00')
  })
  it('pct and plural', () => {
    expect(pct(12.345)).toBe('12.3%')
    expect(plural(1, 'call')).toBe('1 call')
    expect(plural(2, 'call')).toBe('2 calls')
  })
})

describe('dates', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 14, 12, 0)) })
  afterEach(() => { vi.useRealTimers() })

  it('fmtDate adds the year only when it is not this year', () => {
    expect(fmtDate('2026-10-23')).toBe('Oct 23')
    expect(fmtDate('2027-01-15')).toBe('Jan 15, 2027')
    expect(fmtDate(null)).toBe('—')
  })
  it('daysUntil counts whole days', () => {
    expect(daysUntil('2026-10-14')).toBe(0)
    expect(daysUntil('2026-10-30')).toBe(16)
    expect(daysUntil('2026-10-13')).toBe(-1)
  })
})

describe('the market date', () => {
  afterEach(() => { vi.useRealTimers() })

  it("is New York's date, not this computer's", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-15T05:00:00Z'))       // 11 pm Oct 14 in Alberta, 1 am Oct 15 in New York
    expect(marketToday()).toBe('2026-10-15')
    expect(daysUntil('2026-10-15')).toBe(0)                    // expires today, as the API says
    expect(daysUntil('2026-10-16')).toBe(1)
  })
})
