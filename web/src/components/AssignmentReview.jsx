// src/components/AssignmentReview.jsx — "this call expired in the money: were your shares called away?"
import { useState } from 'react'
import { apiError, assignPosition, markNotAssigned } from '../api/client'
import { Dot, Spinner } from './ui'
import { fmtDate, money, plural, strike } from '../lib/format'

export default function AssignmentReview({ items, onChanged }) {
  const [busy, setBusy]   = useState(null)   // id being saved
  const [error, setError] = useState(null)

  if (!items?.length) return null

  const act = async (item, fn) => {
    setBusy(item.id); setError(null)
    try { await fn(item.id); onChanged(fn === assignPosition ? 'assigned' : 'not-assigned', item) }
    catch (e) { setError(apiError(e, 'Could not save that. Is the API running?')) }
    finally { setBusy(null) }
  }

  return (
    <section aria-label="Calls to check" className="mb-6 flex flex-col gap-3">
      {items.map(p => (
        <div key={p.id} className="rounded-card bg-surface p-5">
          <h2 className="flex items-center gap-2.5 text-17 font-semibold"><Dot tone="amber" />Were your {p.ticker} shares called away?</h2>
          <p className="mt-2 text-15 text-fg-2">
            Your {p.ticker} {strike(p.strike)} call expired {fmtDate(p.expiry)} with {p.ticker} at {money(p.close_price)}, so your{' '}
            {(p.contracts * 100).toLocaleString()} shares ({plural(p.contracts, 'contract')}) were probably sold at {money(p.strike)}. Check with your broker.
          </p>
          <div className="mt-4 flex flex-wrap gap-2.5">
            <button type="button" className="btn btn-primary btn-sm min-h-11" disabled={busy != null} onClick={() => act(p, assignPosition)}>
              {busy === p.id ? <Spinner /> : 'Yes, they were'}
            </button>
            <button type="button" className="btn btn-secondary btn-sm min-h-11" disabled={busy != null} onClick={() => act(p, markNotAssigned)}>
              No, I still have them
            </button>
          </div>
        </div>
      ))}
      {error && <p role="alert" className="text-13 text-loss">{error}</p>}
    </section>
  )
}
