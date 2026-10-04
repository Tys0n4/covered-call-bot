// src/components/dialogs/HoldingModal.jsx — add a stock you own, or edit/remove one
import { useState } from 'react'
import { X, AlertTriangle, Trash2 } from 'lucide-react'
import { addHolding, updateHolding, deleteHolding, apiError } from '../../api/client'
import InfoTip from '../InfoTip'
import Modal from './Modal'
import { plural } from '../../lib/format'

export default function HoldingModal({ holding, onClose, onSaved }) {
  const editing = !!holding
  const [ticker, setTicker]     = useState(holding?.ticker ?? '')
  const [shares, setShares]     = useState(holding ? String(holding.shares) : '')
  const [avgCost, setAvgCost]   = useState(holding ? String(holding.avg_cost) : '')
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const sharesNum  = Number.parseInt(shares, 10)
  const costNum    = Number.parseFloat(avgCost)
  const contracts  = Number.isFinite(sharesNum) && sharesNum > 0 ? Math.floor(sharesNum / 100) : 0
  const leftover   = Number.isFinite(sharesNum) && sharesNum > 0 ? sharesNum % 100 : 0
  const openCalls  = holding?.open_total ?? 0
  const minShares  = openCalls * 100

  const problem =
    !editing && !ticker.trim()                             ? 'Enter a ticker symbol.' :
    !Number.isFinite(sharesNum) || sharesNum < 0           ? 'Enter how many shares you own.' :
    !Number.isFinite(costNum) || costNum < 0               ? 'Enter your average cost per share.' :
    editing && sharesNum < minShares                        ? `You need at least ${minShares} shares to cover your ${plural(openCalls, 'open call')}.` :
    null

  const handleSave = async (e) => {
    e.preventDefault()
    if (problem) { setError(problem); return }
    setSaving(true); setError(null)
    try {
      const body = { shares: sharesNum, avg_cost: Math.round(costNum * 100) / 100 }
      const res = editing
        ? await updateHolding(holding.ticker, body)
        : await addHolding({ ticker: ticker.trim().toUpperCase(), ...body })
      onSaved(res.data, editing ? holding.ticker : ticker.trim().toUpperCase())
    } catch (err) {
      setError(apiError(err))
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    setSaving(true); setError(null)
    try {
      const res = await deleteHolding(holding.ticker)
      onSaved(res.data, null)
    } catch (err) {
      setError(apiError(err))
      setSaving(false)
      setConfirmDelete(false)
    }
  }

  return (
    <Modal onDismiss={() => { if (!saving) onClose() }}>
      <form className="card dialog-card" onSubmit={handleSave} style={{ maxWidth: 460 }} role="dialog" aria-modal="true" aria-labelledby="holding-title">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
          <div id="holding-title" style={{ fontWeight: 700, fontSize: 20 }}>{editing ? `Edit ${holding.ticker}` : 'Add a stock'}</div>
          <button type="button" className="link-btn" style={{ color: 'var(--text-muted)', padding: 0 }} onClick={onClose} aria-label="Close" disabled={saving}><X size={20} /></button>
        </div>
        <div className="hint" style={{ marginBottom: 22 }}>
          {editing ? 'Update how many shares you own and what you paid.' : 'Enter a stock you own so you can sell covered calls on it.'}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {!editing && (
            <div>
              <label className="label" htmlFor="h-ticker">Ticker symbol</label>
              <input id="h-ticker" className="input" value={ticker} autoFocus maxLength={10} placeholder="e.g. MSFT"
                onChange={e => setTicker(e.target.value.toUpperCase())}
                style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, letterSpacing: '0.04em' }} />
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div>
              <label className="label" htmlFor="h-shares">Shares owned <InfoTip text="Each 100 shares lets you sell one covered call contract." size={12} /></label>
              <input id="h-shares" className="input" type="number" min={0} step={1} value={shares} autoFocus={editing}
                onChange={e => setShares(e.target.value)} placeholder="e.g. 300" />
            </div>
            <div>
              <label className="label" htmlFor="h-cost">Avg cost per share ($)</label>
              <input id="h-cost" className="input" type="number" min={0} step={0.01} value={avgCost}
                onChange={e => setAvgCost(e.target.value)} placeholder="e.g. 420.00" />
            </div>
          </div>

          <div style={{ background: 'rgba(0,0,0,0.18)', borderRadius: 10, padding: '12px 14px', fontSize: 14, color: 'var(--text-dim)' }}>
            {contracts > 0
              ? <>That's <strong style={{ color: 'var(--accent-light)' }}>{plural(contracts, 'contract')}</strong> you can sell calls on{leftover ? ` (${leftover} shares left over)` : ''}.</>
              : <>You need at least 100 shares to sell a covered call.</>}
            {editing && openCalls > 0 && (
              <div className="hint" style={{ marginTop: 6 }}>{plural(openCalls, 'contract')} already sold, so keep at least {minShares} shares.</div>
            )}
          </div>

          {error && (
            <div className="callout callout-red" style={{ padding: '10px 12px', fontSize: 13 }}>
              <AlertTriangle size={16} strokeWidth={1.75} style={{ flexShrink: 0, marginTop: 1 }} /> {error}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="dialog-actions" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 24, gap: 12, flexWrap: 'wrap' }}>
          <div>
            {editing && !confirmDelete && (
              <button type="button" className="link-btn" style={{ color: openCalls ? 'var(--text-muted)' : 'var(--red)', fontSize: 13 }}
                onClick={() => (openCalls ? setError(`Close the ${plural(openCalls, 'open call')} on ${holding.ticker} before removing it.`) : setConfirmDelete(true))}
                disabled={saving}>
                <Trash2 size={14} /> Remove stock
              </button>
            )}
            {editing && confirmDelete && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                <span style={{ color: 'var(--red)' }}>Remove {holding.ticker}?</span>
                <button type="button" className="btn-danger" style={{ padding: '6px 12px' }} onClick={handleDelete} disabled={saving}>Yes, remove</button>
                <button type="button" className="link-btn" style={{ color: 'var(--text-muted)', fontSize: 13 }} onClick={() => setConfirmDelete(false)} disabled={saving}>Cancel</button>
              </span>
            )}
          </div>
          {!confirmDelete && (
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? <><span className="spinner" /> {editing ? 'Saving…' : 'Checking ticker…'}</> : editing ? 'Save changes' : 'Add stock'}
              </button>
            </div>
          )}
        </div>
      </form>
    </Modal>
  )
}
