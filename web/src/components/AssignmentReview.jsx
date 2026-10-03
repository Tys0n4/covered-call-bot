// src/components/AssignmentReview.jsx — "this call expired in the money: were your shares called away?"
import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { apiError, assignPosition, markNotAssigned } from '../api/client'
import { fmtDate, money, plural } from '../lib/format'

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
    <div className="callout callout-amber" style={{ flexDirection: 'column', gap: 12, marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
        <AlertTriangle size={18} strokeWidth={1.75} />
        {items.length === 1 ? 'A call may have been assigned' : `${items.length} calls may have been assigned`}
      </div>
      {items.map(p => (
        <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px 16px', flexWrap: 'wrap', color: 'var(--text-dim)' }}>
          <span>
            Your <strong style={{ color: 'var(--text)' }}>{money(p.strike)} {p.ticker}</strong> call expired {fmtDate(p.expiry)} with {p.ticker} at{' '}
            <strong style={{ color: 'var(--text)' }}>{money(p.close_price)}</strong>, so your {(p.contracts * 100).toLocaleString()} shares
            ({plural(p.contracts, 'contract')}) were probably called away. Check with your broker.
          </span>
          <span style={{ display: 'flex', gap: 8 }}>
            <button className="btn-primary" style={{ padding: '7px 14px' }} disabled={busy != null} onClick={() => act(p, assignPosition)}>
              {busy === p.id ? <span className="spinner" style={{ width: 14, height: 14 }} /> : 'Yes, they were'}
            </button>
            <button className="btn-secondary" style={{ padding: '7px 14px' }} disabled={busy != null} onClick={() => act(p, markNotAssigned)}>
              No, I still have them
            </button>
          </span>
        </div>
      ))}
      {error && <div role="alert" style={{ color: 'var(--red)', fontSize: 13 }}>{error}</div>}
    </div>
  )
}
