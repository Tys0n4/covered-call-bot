// @vitest-environment jsdom
// The price check Home and Positions share: reused while it covers the calls on screen,
// asked again when it doesn't, and the last prices kept while a new check runs
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getManagement } from '../api/client'
import { forgetPriceChecks, usePriceCheck } from './usePriceCheck'

vi.mock('../api/client', () => ({
  getManagement: vi.fn(),
  apiError: (e, fallback) => e?.response?.data?.detail || fallback,
}))

const check = (...ids) => ({ data: { positions: ids.map(id => ({ id, should_buy_back: false })), checked_at: '2026-10-14T15:00:00Z' } })

beforeEach(() => {
  forgetPriceChecks()
  getManagement.mockReset()
})

describe('usePriceCheck', () => {
  it('checks once and returns the result', async () => {
    getManagement.mockResolvedValue(check(1, 2))
    const { result } = renderHook(() => usePriceCheck([1, 2]))
    expect(result.current.checking).toBe(true)
    await waitFor(() => expect(result.current.checking).toBe(false))
    expect(result.current.data.positions.map(p => p.id)).toEqual([1, 2])
    expect(getManagement).toHaveBeenCalledTimes(1)
  })

  it('does nothing without calls on screen', () => {
    const { result } = renderHook(() => usePriceCheck([]))
    expect(result.current.checking).toBe(false)
    expect(getManagement).not.toHaveBeenCalled()
  })

  it('reuses a check that covers every call (another page)', async () => {
    getManagement.mockResolvedValue(check(1, 2))
    const first = renderHook(() => usePriceCheck([1, 2]))
    await waitFor(() => expect(first.result.current.data).not.toBeNull())
    const second = renderHook(() => usePriceCheck([2, 1]))
    expect(second.result.current.data).not.toBeNull()          // right away, no spinner
    expect(second.result.current.checking).toBe(false)
    expect(getManagement).toHaveBeenCalledTimes(1)
  })

  it('checks again when a call is missing from the last check', async () => {
    getManagement.mockResolvedValueOnce(check(1)).mockResolvedValueOnce(check(1, 3))
    const first = renderHook(() => usePriceCheck([1]))
    await waitFor(() => expect(first.result.current.data).not.toBeNull())
    const second = renderHook(() => usePriceCheck([1, 3]))
    await waitFor(() => expect(second.result.current.data?.positions).toHaveLength(2))
    expect(getManagement).toHaveBeenCalledTimes(2)
  })

  it('refresh asks again and keeps the last prices meanwhile', async () => {
    getManagement.mockResolvedValueOnce(check(1))
    const { result } = renderHook(() => usePriceCheck([1]))
    await waitFor(() => expect(result.current.data).not.toBeNull())
    let finish
    getManagement.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    act(() => result.current.refresh())
    expect(result.current.checking).toBe(true)
    expect(result.current.data).not.toBeNull()                 // still showing the last check
    await act(async () => finish(check(1)))
    expect(result.current.checking).toBe(false)
    expect(getManagement).toHaveBeenCalledTimes(2)
  })

  it('says why when the check fails', async () => {
    getManagement.mockRejectedValue({ response: { data: { detail: 'Cboe is down' } } })
    const { result } = renderHook(() => usePriceCheck([1]))
    await waitFor(() => expect(result.current.error).toBe('Cboe is down'))
  })

  it('checks one stock separately from all of them', async () => {
    getManagement.mockResolvedValue(check(1))
    const all = renderHook(() => usePriceCheck([1]))
    await waitFor(() => expect(all.result.current.data).not.toBeNull())
    const one = renderHook(() => usePriceCheck([1], 'NVDA'))
    await waitFor(() => expect(one.result.current.data).not.toBeNull())
    expect(getManagement).toHaveBeenLastCalledWith('NVDA')
  })
})
