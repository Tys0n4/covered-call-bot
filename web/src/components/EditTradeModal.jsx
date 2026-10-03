// src/components/EditTradeModal.jsx — fix what was recorded for a trade (fill, fees, buyback cost)
import { useState } from 'react'
import { apiError, editPosition } from '../api/client'
import Modal from './Modal'
import MoneyInput from './MoneyInput'
import { fmtDate, money, plural } from '../lib/format'
import { moneyValue } from '../lib/pnl'

const toText = v => (v == null ? '' : String(Number(v).toFixed(2)))

export default function EditTradeModal({ position: p, onDone, onCancel }) {
  const boughtBack = p.status === 'CLOSED'
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

  const submit = async () => {
    if (fillError || !dirty) return
    setBusy(true); setError(null)
    try { await editPosition(p.id, changes); onDone() }
    catch (e) { setError(apiError(e, 'Could not save. Is the API running?')); setBusy(false) }
  }

  return (
    <Modal onBackdrop={() => { if (!busy) onCancel() }}>
      <div className="card" role="dialog" aria-modal="true" aria-label="Edit trade"
        style={{ width: '100%', maxWidth: 460, padding: 28, animation: 'fadeUp 0.2s ease forwards' }}>
        <div style={{ fontWeight: 700, fontSize: 19, marginBottom: 4 }}>Edit trade</div>
        <div className="hint" style={{ marginBottom: 18 }}>
          {p.ticker} · {money(p.strike)} call · expires {fmtDate(p.expiry)} · {plural(p.contracts, 'contract')}.
          Fix what was recorded so your results are right.
        </div>

        <div className="grid-2" style={{ gap: 12 }}>
          <MoneyInput id="edit-fill" label="Sold for (per share)" value={fill} onChange={setFill} error={fillError}
            hint={fillError ? null : `Premium ${money(premium)}`} />
          <MoneyInput id="edit-open-fees" label="Fees when sold" value={openFees} onChange={setOpenFees} />
          {boughtBack && <>
            <MoneyInput id="edit-cost" label="Paid to buy back (total)" value={cost} onChange={setCost}
              hint={p.close_cost == null ? 'Not entered yet' : null} />
            <MoneyInput id="edit-close-fees" label="Fees when bought back" value={closeFees} onChange={setCloseFees} />
          </>}
        </div>

        {error && <div role="alert" style={{ marginTop: 12, color: 'var(--red)', fontSize: 13 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 20 }}>
          <button className="btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={busy || !!fillError || !dirty}>
            {busy ? <><span className="spinner" /> Saving…</> : 'Save changes'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
