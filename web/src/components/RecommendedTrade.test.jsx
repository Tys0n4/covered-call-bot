// @vitest-environment jsdom
// The Scanner's answer for one stock: one call for every free contract, the catch in plain
// words, the order to place, the alternative, and recording what the broker filled
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../context/ToastContext'
import RecommendedTrade from './RecommendedTrade'

afterEach(cleanup)

const call = (strike, delta, extra = {}) => ({ expiry: '2026-10-30', strike, dte: 15, delta, ...extra })
const RESULT = {
  ticker: 'AAPL',
  avg_cost: 300,
  planned_positions: [{ expiry: '2026-10-30', strike: 357.5, contracts: 3, entry_price: 1.71, premium_total: 513, allocation_type: 'Income' }],
  alternative: { expiry: '2026-10-30', strike: 365, contracts: 3, entry_price: 0.9, premium_total: 270, allocation_type: 'Balanced' },
  candidates: [call(357.5, 0.2), call(365, 0.13, { spans_earnings: true })],
  event_notes: [],
  premium_check: { level: 'normal' },
  goal_check: null,
}

function show(props = {}) {
  const handlers = { onToggleAlt: vi.fn(), onFill: vi.fn(), onFees: vi.fn(), onSave: vi.fn() }
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

describe('RecommendedTrade', () => {
  it('shows one call for every free contract and what it collects', () => {
    show()
    expect(screen.getByRole('heading', { name: /Sell 3 calls, collect about/ })).toBeTruthy()
    expect(screen.getByText('$513')).toBeTruthy()
    expect(screen.getByText(/3 × \$357\.50 call · expires Oct 30/)).toBeTruthy()
  })

  it('says the catch in plain words, with the chance and the tax if shares are sold', () => {
    show()
    const text = screen.getByRole('heading', { name: 'The catch' }).parentElement.textContent
    expect(text).toContain('If AAPL closes above $357.50 on Oct 30, your 300 shares are sold at $357.50.')
    expect(text).toContain('about a 20% chance')
    expect(text).toContain("you'd owe tax on about $17,250 of gain, since you bought at $300.00")
  })

  it('gives the order to place at the broker', () => {
    show()
    const order = screen.getByRole('heading', { name: 'Place this order at your broker' }).parentElement.textContent
    expect(order).toContain('Sell to open · 3 contracts')
    expect(order).toContain('AAPL Oct 30 $357.50 call')
    expect(order).toContain('Limit $1.71')
  })

  it('offers the alternative only as a different call', () => {
    const { onToggleAlt } = show()
    fireEvent.click(screen.getByRole('button', { name: /Or keep more room to rise/ }))
    expect(onToggleAlt).toHaveBeenCalled()
    cleanup()
    show({ result: { ...RESULT, alternative: null } })
    expect(screen.queryByText(/Or keep more room to rise/)).toBeNull()
  })

  it('shows the alternative with its own event line when chosen', () => {
    show({ useAlt: true })
    expect(screen.getByText(/3 × \$365 call/)).toBeTruthy()
    expect(screen.getByText('It expires after AAPL earnings.')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Or the recommended call/ })).toBeTruthy()
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
