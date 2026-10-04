// src/lib/useStrategy.js — your saved strategy, fetched once and shared by
// every page and dialog that needs it (the commission, mostly)
import { useEffect, useState } from 'react'
import { getStrategy } from '../api/client'

let cached = null      // { promise, value }

export function forgetStrategy(value = null) {
  cached = value ? { promise: Promise.resolve(value), value } : null
}

export function useStrategy() {
  const [strategy, setStrategy] = useState(cached?.value ?? null)
  useEffect(() => {
    if (!cached) {
      const entry = { value: null }
      entry.promise = getStrategy().then(r => (entry.value = r.data))
      entry.promise.catch(() => { if (cached === entry) cached = null })
      cached = entry
    }
    let live = true
    cached.promise.then(v => { if (live) setStrategy(v) }).catch(() => {})
    return () => { live = false }
  }, [])
  return strategy
}

// Fee boxes only matter when your broker charges a commission
export const chargesCommission = strategy => (strategy?.commission_per_contract ?? 0) > 0
