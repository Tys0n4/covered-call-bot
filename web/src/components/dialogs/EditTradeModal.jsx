// src/components/dialogs/EditTradeModal.jsx — fix what was recorded for a trade (fill, fees, buyback cost)
import { useState } from 'react'
import { apiError, editPosition } from '../../api/client'
import Modal, { DialogHead } from './Modal'
import { MoneyField, Spinner } from '../ui'
import { useStrategy, chargesCommission } from '../../lib/useStrategy'
import { fmtDate, money, plural, strike } from '../../lib/format'
import { moneyValue } from '../../lib/pnl'

const toText = v => (v == null ? '' : String(Number(v).toFixed(2)))

export default function EditTradeModal({ position: p, onDone, onCancel }) {
  const boughtBack = p.status === 'CLOSED'
  // Fee boxes when your broker charges, or this trade already has fees recorded
  const showFees = chargesCommission(useStrategy()) || (p.open_fees || 0) > 0 || (p.close_fees || 0) > 0
  const [fill, setFill]           = useState(toText(p.entry_price))
  const [openFees, setOpenFees]   = useState(toText(p.open_fees))
  const [cost, setCost]           = useState(toText(p.close_cost))
  const [closeFees, setCloseFees] = useState(toText(p.close_fees))
  const [busy, setBusy]           = useState(false)
  const [error, setError]         = useState(null)

  const fillValue = moneyValue(fill)
  const fillError = fillValue == null || !(fillValue > 0) ? 'Enter the price it sold for' : null

  // Send only what changed
  const changes = {}
  const diff = (key, text, original) => {
    const v = moneyValue(text)
    if (v != null && v !== Number(original ?? NaN)) changes[key] = v
  }
  diff('entry_price', fill, p.entry_price)
  diff('open_fees', openFees, p.open_fees)
  if (boughtBack) {
    diff('close_cost', cost, p.close_cost)
    diff('close_fees', closeFees, p.close_fees)
  }
  const dirty = Object.keys(changes).length > 0

  const premium = (fillValue || 0) * p.contracts * 100
  const kept = premium - (moneyValue(openFees) || 0) - (boughtBack ? (moneyValue(cost) || 0) + (moneyValue(closeFees) || 0) : 0)
  const status = p.status === 'OPEN' ? 'open' : p.status === 'CLOSED' ? `bought back ${fmtDate(p.closed_at)}` : `${p.status.toLowerCase()} ${fmtDate(p.closed_at)}`

  const submit = async () => {
    if (fillError || !dirty) return
    setBusy(true); setError(null)
    try { await editPosition(p.id, changes); onDone() }
    catch (e) { setError(apiError(e, 'Could not save. Is the API running?')); setBusy(false) }
  }

  return (
    <Modal onDismiss={() => { if (!busy) onCancel() }} labelledBy="edit-title" width={500}>
      <DialogHead id="edit-title" title="Edit trade" onClose={onCancel} disabled={busy}
        sub={`${p.ticker} ${strike(p.strike)} call · ${status} · ${plural(p.contracts, 'contract')}`} />

      <div className={`mt-5 grid gap-x-3 gap-y-4 ${showFees || boughtBack ? 'grid-cols-2' : ''}`}>
        <MoneyField id="edit-fill" label="Sold for (per share)" value={fill} onChange={setFill} error={fillError} />
        {showFees && <MoneyField id="edit-open-fees" label="Fees when sold" value={openFees} onChange={setOpenFees} />}
        {boughtBack && <>
          <MoneyField id="edit-cost" label="Paid to buy back (total)" value={cost} onChange={setCost}
            hint={p.close_cost == null ? 'Not entered yet' : null} />
          {showFees && <MoneyField id="edit-close-fees" label="Fees when bought back" value={closeFees} onChange={setCloseFees} />}
        </>}
      </div>

      <div className="mt-4 flex items-baseline justify-between gap-3 rounded-sm bg-panel px-4 py-3">
        <span className="text-fg-2">Premium {money(premium)}</span>
        {p.status !== 'OPEN' && <span>You kept <strong className="text-17 font-semibold text-accent">{money(kept)}</strong></span>}
      </div>

      {error && <p role="alert" className="mt-3 text-13 text-loss">{error}</p>}
      <div className="dialog-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={submit} disabled={busy || !!fillError || !dirty}>
          {busy ? <><Spinner /> Saving…</> : 'Save changes'}
        </button>
      </div>
    </Modal>
  )
}
