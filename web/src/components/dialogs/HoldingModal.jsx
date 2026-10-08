// src/components/dialogs/HoldingModal.jsx — add a stock you own, or edit/remove one
import { useState } from 'react'
import { addHolding, updateHolding, deleteHolding, apiError } from '../../api/client'
import Modal, { DialogHead } from './Modal'
import { Field, Spinner } from '../ui'
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
    <Modal as="form" onSubmit={handleSave} onDismiss={() => { if (!saving) onClose() }} labelledBy="holding-title" width={460}>
      <DialogHead id="holding-title" title={editing ? `Edit ${holding.ticker}` : 'Add a stock'}
        sub={editing ? 'How many shares you own and what you paid.' : 'A stock you own, so you can sell covered calls on it.'}
        onClose={onClose} disabled={saving} />

      {!editing && (
        <Field className="mt-5" id="h-ticker" label="Ticker symbol" value={ticker} autoFocus maxLength={10} placeholder="e.g. MSFT"
          onChange={e => setTicker(e.target.value.toUpperCase())} inputClassName="font-semibold tracking-wide" />
      )}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <Field id="h-shares" label="Shares owned" type="text" inputMode="numeric" value={shares} autoFocus={editing} placeholder="e.g. 300"
          onChange={e => setShares(e.target.value.replace(/[^0-9]/g, ''))} />
        <Field id="h-cost" label="Average cost per share" prefix="$" type="text" inputMode="decimal" value={avgCost} placeholder="0.00"
          onChange={e => setAvgCost(e.target.value.replace(/[^0-9.]/g, ''))} />
      </div>

      <p className="mt-4 rounded-sm bg-panel px-4 py-3 text-15 text-fg-2">
        {contracts > 0
          ? <><strong className="font-semibold text-accent">{plural(contracts, 'contract')}</strong> you can sell calls on{leftover ? ` (${leftover} shares left over)` : ''}.</>
          : 'You need at least 100 shares to sell a covered call.'}
        {editing && openCalls > 0 && <span className="mt-1 block text-13 text-muted">{plural(openCalls, 'contract')} already sold, so keep at least {minShares} shares.</span>}
      </p>

      {error && <p role="alert" className="mt-3 text-13 text-loss">{error}</p>}

      <div className="dialog-actions items-center">
        {editing && (confirmDelete ? (
          <span className="mr-auto flex items-center gap-2 text-13">
            <span className="text-loss">Remove {holding.ticker}?</span>
            <button type="button" className="btn btn-danger btn-sm" onClick={handleDelete} disabled={saving}>Yes, remove</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(false)} disabled={saving}>Keep</button>
          </span>
        ) : (
          <button type="button" className="btn btn-ghost mr-auto flex-none text-loss hover:text-loss" disabled={saving}
            onClick={() => (openCalls ? setError(`Close the ${plural(openCalls, 'open call')} on ${holding.ticker} before removing it.`) : setConfirmDelete(true))}>
            Remove
          </button>
        ))}
        {!confirmDelete && <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? <><Spinner /> {editing ? 'Saving…' : 'Checking ticker…'}</> : editing ? 'Save' : 'Add stock'}
          </button>
        </>}
      </div>
    </Modal>
  )
}
