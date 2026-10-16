// @vitest-environment jsdom
// Every call that fit, in plain words: what it pays for your contracts, the chance your
// shares are sold, how far the stock can rise first, and how easily it fills
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import CallsList from './CallsList'

afterEach(cleanup)

const call = (expiry, dte, strike, premium, delta, spread, extra = {}) => ({
  expiry, dte, strike, premium_price: premium, delta, spread_pct: spread, upside_to_strike_pct: (strike / 340.81 - 1) * 100,
  quote_quality: 'LIVE', ...extra,
})
const CALLS = [
  call('2026-10-30', 15, 355, 1.95, 0.22, 6.2),
  call('2026-10-30', 15, 352.5, 2.64, 0.27, 9.8, { spans_fed: true }),
  call('2026-11-13', 29, 360, 3.95, 0.26, 12.7, { spans_earnings: true, spans_fed: true }),
]
const show = () => render(<CallsList candidates={CALLS} ticker="AAPL" price={340.81} contracts={3}
  picked={new Map([['2026-10-30|355', 'Picked']])} />)

const rows = () => screen.getAllByRole('listitem').map(li => li.textContent)

describe('CallsList', () => {
  it('says what each call pays for your contracts, a month, and the chance of selling', () => {
    show()
    const picked = screen.getAllByRole('listitem').find(li => li.textContent.includes('Picked'))
    expect(within(picked).getByText('$585')).toBeTruthy()
    expect(within(picked).getByText('$1,186 a month')).toBeTruthy()
    expect(picked.textContent).toContain('22% chance your shares are sold')
    expect(picked.textContent).toContain('AAPL can rise 4.2% first')
    expect(picked.textContent).toContain('Easy to fill near this price')
  })

  it('warns about wide price gaps in words', () => {
    show()
    expect(rows().find(t => t.includes('$352.50'))).toContain('Price gap a bit wide')
    expect(rows().find(t => t.includes('$360'))).toContain('Wide price gap: likely to fill lower')
  })

  it('groups by date with the events before each expiry, or sorts by money or safety', () => {
    show()
    expect(screen.getByRole('region', { name: 'Expiring Nov 13' }).textContent).toContain('after AAPL earnings and the Fed decision')
    fireEvent.click(screen.getByRole('button', { name: 'Most a month' }))
    expect(rows()[0]).toContain('$352.50')
    fireEvent.click(screen.getByRole('button', { name: 'Least chance of selling' }))
    expect(rows()[0]).toContain('$355')
    expect(rows()[0]).toContain('Oct 30 · 15 days')
  })
})
