// @vitest-environment jsdom
// The Scanner's answer for one stock: the call that fits your rules for every free contract,
// the catch in plain words with the tax, the order with the bid and ask to check, the
// alternative, the goal's pace (never by taking more risk), and recording the fill
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../context/ToastContext'
import RecommendedTrade from './RecommendedTrade'

afterEach(cleanup)

const call = (strike, delta, extra = {}) => ({ expiry: '2026-10-30', strike, dte: 15, delta, spread_pct: 6, bid: 1.6, ask: 1.82, ...extra })
const RESULT = {
  ticker: 'AAPL',
  avg_cost: 300,
  delta_min: 0.2, delta_max: 0.3, min_dte: 14, max_dte: 30,
  planned_positions: [{ expiry: '2026-10-30', strike: 357.5, contracts: 3, entry_price: 1.71, premium_total: 513, allocation_type: 'Income' }],
  alternative: { expiry: '2026-10-30', strike: 365, contracts: 3, entry_price: 0.9, premium_total: 270, allocation_type: 'Balanced' },
  candidates: [call(357.5, 0.2), call(365, 0.13, { spans_earnings: true, spread_pct: 14 })],
  event_notes: [],
  premium_check: { level: 'normal', implied_vol: 0.3, realized_vol: 0.28 },
  goal_check: null,
}

function show(props = {}) {
  const handlers = { onToggleAlt: vi.fn(), onFill: vi.fn(), onFees: vi.fn(), onSave: vi.fn(), onTaxAccount: vi.fn() }
  render(
    <MemoryRouter>
      <ToastProvider>
        <RecommendedTrade result={RESULT} useAlt={false} fill="" fees="" showFees={false} saved={false} saving={false}
          lastPrices={false} nextOpen={null} {...handlers} {...props} />
      </ToastProvider>
    </MemoryRouter>,
  )
  return handlers
}

const catchText = () => screen.getByRole('heading', { name: 'The catch' }).parentElement.textContent
const orderText = () => screen.getByRole('heading', { name: 'If you decide to sell, the order at your broker' }).parentElement.textContent

describe('RecommendedTrade', () => {
  it('shows the call that fits your rules, the rules, and what it collects at the middle price', () => {
    show()
    expect(screen.getByRole('heading', { name: /The call that fits your rules: sell 3 calls, collect about/ })).toBeTruthy()
    expect(screen.getByText('$513')).toBeTruthy()
    expect(screen.getByText(/3 × \$357\.50 call · expires Oct 30/)).toBeTruthy()
    expect(screen.getByText(/if it fills at the middle price$/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Your rules: about a 20–30% chance of selling' })).toBeTruthy()
    expect(screen.getByRole('link', { name: '14–30 days' })).toBeTruthy()
  })

  it('says the catch in plain words, with the chance and the tax as an estimate', () => {
    show()
    expect(catchText()).toContain('If AAPL closes above $357.50 on Oct 30, your 300 shares are sold at $357.50.')
    expect(catchText()).toContain('about a 20% chance')
    expect(catchText()).toContain('A gain of about $17,250 over the $300.00 you paid')
    expect(catchText()).toContain('long-term rate')
    expect(catchText()).toContain('An estimate, not tax advice.')
  })

  it('knows there is no tax now in a retirement account, and lets you switch', () => {
    const { onTaxAccount } = show({ taxAccount: 'retirement' })
    expect(catchText()).toContain("In an IRA or other retirement account there's no tax when they're sold.")
    fireEvent.click(screen.getByRole('button', { name: 'Change to a taxable account' }))
    expect(onTaxAccount).toHaveBeenCalledWith('taxable')
  })

  it('gives the order with the bid and ask to check first', () => {
    show()
    expect(orderText()).toContain('Sell to open · 3 contracts')
    expect(orderText()).toContain('AAPL Oct 30 $357.50 call')
    expect(orderText()).toContain('Limit $1.71')
    expect(orderText()).toContain('$1.71 is the middle of the $1.60 bid and $1.82 ask')
    expect(orderText()).toContain('if the bid has dropped, lower the limit or wait')
  })

  it('says when a goal is out of reach within your rules, without picking a riskier call', () => {
    show({ result: { ...RESULT, goal_check: { goal: 1500, contracts: 8, pace_per_contract: 187.5, plan_per_contract: 120, met: false } } })
    const note = screen.getByRole('note').textContent
    expect(note).toContain('Short of your $1,500 goal.')
    expect(note).toContain("AAPL's 3 contracts would need about $563 a month")
    expect(note).toContain('brings about $360 a month')
    expect(note).toContain('instead of picking a riskier call')
  })

  it('offers the alternative only as a different call', () => {
    const { onToggleAlt } = show()
    fireEvent.click(screen.getByRole('button', { name: /Or keep more room to rise/ }))
    expect(onToggleAlt).toHaveBeenCalled()
    cleanup()
    show({ result: { ...RESULT, alternative: null } })
    expect(screen.queryByText(/Or keep more room to rise/)).toBeNull()
  })

  it('shows the alternative with its own events, and warns when it trades thinly', () => {
    show({ useAlt: true })
    expect(screen.getByRole('heading', { name: /With more room to rise: sell 3 calls/ })).toBeTruthy()
    expect(screen.getByText(/3 × \$365 call · expires/)).toBeTruthy()
    expect(screen.getByText('It expires after AAPL earnings.')).toBeTruthy()
    expect(screen.getByText(/trades thinly, so it often fills a little lower/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Or the call that fits your rules best/ })).toBeTruthy()
  })

  it('fills the quote only while prices are live', () => {
    const { onFill } = show()
    fireEvent.click(screen.getByRole('button', { name: 'Use $1.71' }))
    expect(onFill).toHaveBeenCalledWith('1.71')
    cleanup()
    show({ lastPrices: true })
    expect(screen.queryByRole('button', { name: /^Use / })).toBeNull()
    expect(screen.getByText(/The market isn't open/)).toBeTruthy()
  })

  it('saves only with a price, and says what it collects', () => {
    show()
    expect(screen.getByRole('button', { name: 'Save' }).disabled).toBe(true)
    cleanup()
    const { onSave } = show({ fill: '1.70' })
    expect(screen.getByText('At this price you collect $510.00.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalled()
  })
})
