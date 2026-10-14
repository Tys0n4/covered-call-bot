// src/lib/usePriceCheck.js — the price check (/manage) that Home and Positions share.
// A check is reused for a minute when it covers every open call on screen, so going
// from Home to Positions and back doesn't check again. While the market is open and
// the tab is visible, it checks again by itself every 5 minutes. The last prices stay
// on screen while a new check runs.
import { useCallback, useEffect, useState } from 'react'
import { apiError, getManagement } from '../api/client'
import { useMarket } from '../context/MarketContext'

const FRESH = 60 * 1000          // reuse a check this long
export const AUTO = 5 * 60 * 1000 // check again this often while the market is open

const checks = new Map()          // ticker ('' = every stock) -> { ids: Set, data }, for a minute
const checkedAt = new Map()       // ticker -> when its last check came back

// After a call changes, or the buy-back targets do, the next check asks the API again
export function forgetPriceChecks() { checks.clear() }

function remember(key, data) {
  const entry = { ids: new Set(data.positions.map(e => e.id)), data }
  checks.set(key, entry)
  checkedAt.set(key, Date.now())
  setTimeout(() => { if (checks.get(key) === entry) checks.delete(key) }, FRESH)
}

function lookup(key, ids) {
  const entry = checks.get(key)
  return entry && ids.every(id => entry.ids.has(id)) ? entry.data : null
}

// ids: the open calls on screen (none = nothing to check); ticker: only that stock's
// calls (null = every stock). Returns { data, checking, error, refresh }, where data is
// the last /manage response.
export function usePriceCheck(ids, ticker = null) {
  const { open: marketOpen } = useMarket()
  const key = ticker || ''
  const idsKey = [...ids].sort((a, b) => a - b).join(',')
  const enabled = idsKey !== ''
  const [round, setRound] = useState(0)    // bumped by refresh() and the 5-minute timer
  const req = `${key}|${idsKey}|${round}`
  const [result, setResult] = useState(() => {
    const data = enabled ? lookup(key, ids) : null
    return { req: data ? req : null, data, error: null }
  })

  useEffect(() => {
    if (!enabled || result.req === req) return
    let live = true
    const wanted = idsKey.split(',').map(Number)
    const cached = lookup(key, wanted)
    const check = cached
      ? Promise.resolve(cached)
      : getManagement(ticker).then(r => { remember(key, r.data); return r.data })
    check
      .then(data => { if (live) setResult({ req, data, error: null }) })
      .catch(e => { if (live) setResult({ req, data: null, error: apiError(e, 'Could not check prices. Is the API running?') }) })
    return () => { live = false }
  }, [req, enabled, result.req, key, idsKey, ticker])

  const refresh = useCallback(() => { checks.delete(key); setRound(n => n + 1) }, [key])

  // While the market is open and you're looking: check again every 5 minutes,
  // and when you come back to the tab after longer than that
  useEffect(() => {
    if (!enabled || !marketOpen) return
    const timer = setInterval(() => { if (document.visibilityState === 'visible') refresh() }, AUTO)
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - (checkedAt.get(key) ?? 0) > AUTO) refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [enabled, marketOpen, key, refresh])

  return {
    data: result.data,
    checking: enabled && result.req !== req,
    error: result.req === req ? result.error : null,
    refresh,
  }
}
