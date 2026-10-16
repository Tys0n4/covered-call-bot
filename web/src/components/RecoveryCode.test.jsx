// @vitest-environment jsdom
// The recovery code is shown once, so the app won't go on until you say you saved it
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RecoveryCodeScreen from './RecoveryCode'

afterEach(cleanup)

describe('RecoveryCodeScreen', () => {
  it('shows the code and waits for "I saved it"', () => {
    const onDone = vi.fn()
    render(<RecoveryCodeScreen code="K7QF-2M9X-HT4P-8WZC" email="you@example.com" kicker="Account created" onDone={onDone} />)
    expect(screen.getByText('K7QF-2M9X-HT4P-8WZC')).toBeTruthy()
    const go = screen.getByRole('button', { name: 'Continue' })
    expect(go.disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: 'I saved it somewhere safe' }))
    expect(go.disabled).toBe(false)
    fireEvent.click(go)
    expect(onDone).toHaveBeenCalled()
  })

  it('offers to copy it or save it as a file', () => {
    render(<RecoveryCodeScreen code="K7QF-2M9X-HT4P-8WZC" kicker="Account created" onDone={() => {}} />)
    expect(screen.getByRole('button', { name: /Copy/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Save as a file/ })).toBeTruthy()
  })
})
