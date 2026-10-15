// @vitest-environment jsdom
// Rolls for a call: the card and the dialog share one request
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { getRolls } from '../api/client'
import { forgetRolls, useRolls } from './useRolls'

vi.mock('../api/client', () => ({
  getRolls: vi.fn(),
  apiError: (e, fallback) => e?.response?.data?.detail || fallback,
}))

const found = { data: { position_id: 5, buyback_price: 14.35, rolls: [{ expiry: '2026-11-20', strike: 215, net_total: 114 }] } }

beforeEach(() => {
  forgetRolls()
  getRolls.mockReset()
})

it('the card and the dialog share one request', async () => {
  getRolls.mockResolvedValue(found)
  const card = renderHook(() => useRolls(5))
  const dialog = renderHook(() => useRolls(5))
  await waitFor(() => expect(card.result.current.data).not.toBeNull())
  await waitFor(() => expect(dialog.result.current.data).not.toBeNull())
  expect(getRolls).toHaveBeenCalledTimes(1)
  // Opened later, the dialog has them straight away
  expect(renderHook(() => useRolls(5)).result.current.loading).toBe(false)
})

it('asks again once a call changes', async () => {
  getRolls.mockResolvedValue(found)
  const first = renderHook(() => useRolls(5))
  await waitFor(() => expect(first.result.current.data).not.toBeNull())
  forgetRolls()
  const again = renderHook(() => useRolls(5))
  expect(again.result.current.loading).toBe(true)
  await waitFor(() => expect(again.result.current.data).not.toBeNull())
  expect(getRolls).toHaveBeenCalledTimes(2)
})

it('says why rolls could not be found, and tries again next time', async () => {
  getRolls.mockRejectedValueOnce({}).mockResolvedValueOnce(found)
  const failed = renderHook(() => useRolls(5))
  await waitFor(() => expect(failed.result.current.error).toMatch(/Couldn't look for rolls/))
  const retry = renderHook(() => useRolls(5))
  await waitFor(() => expect(retry.result.current.data).not.toBeNull())
})

it('loads nothing without a call', () => {
  const { result } = renderHook(() => useRolls(null))
  expect(result.current.loading).toBe(false)
  expect(getRolls).not.toHaveBeenCalled()
})
