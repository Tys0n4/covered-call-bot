// src/components/dialogs/EditTradeModal.jsx — fix what was recorded for a trade (fill, fees, buyback price)
import { useState } from 'react'
import { apiError, editPosition } from '../../api/client'
import Modal, { DialogHead } from './Modal'
import { MoneyField, Spinner } from '../ui'
import { useStrategy, chargesCommission } from '../../lib/useStrategy'
import { fmtDate, money, plural, strike } from '../../lib/format'
import { contractsTotal, moneyValue } from '../../lib/pnl'

const toText = v => (v == null ? '' : String(Number(v).toFixed(2)))
// A buyback total back to its price per share; up to 4 decimals, so a total that
// isn't a whole cent a share (one that includes a commission, say) still adds up
function perShareText(total, contracts) {
  if (total == null) return ''
  const price = total / (contracts * 100)
  const exact = String(Number(price.toFixed(4)))
  return (exact.split('.')[1] || '').length > 2 ? exact : price.toFixed(2)
}

export default function EditTradeModal({ position: p, onDone, onCancel }) {
  const boughtBack = p.status === 'CLOSED'
  // Fee boxes when your broker charges, or this trade already has fees recorded
  const showFees = chargesCommission(useStrategy()) || (p.open_fees || 0) > 0 || (p.close_fees || 0) > 0
  const [start] = useState(() => ({
    fill: toText(p.entry_price), openFees: toText(p.open_fees), buy: perShareText(p.close_cost, p.contracts), closeFees: toText(p.close_fees),
  }))
  const [fill, setFill]           = useState(start.fill)
  const [openFees, setOpenFees]   = useState(start.openFees)
  const [buy, setBuy]             = useState(start.buy)
  const [closeFees, setCloseFees] = useState(start.closeFees)
  const [busy, setBusy]           = useState(false)
  const [error, setError]         = useState(null)

  const fillValue = moneyValue(fill)
  const fillError = fillValue == null || !(fillValue > 0) ? 'Enter the price it sold for' : null
  const buyValue = moneyValue(buy)
  // The saved total stays as it was unless you change the price
  const cost = buy === start.buy ? p.close_cost : buyValue == null ? null : contractsTotal(buyValue, p.contracts)
  const oddCents = buy === start.buy && p.close_cost != null && buy.includes('.') && buy.split('.')[1].length > 2

  // Send only what changed
  const changes = {}
  const diff = (key, text, initial, value = moneyValue(text)) => {
    if (text !== initial && value != null) changes[key] = value
  }
  diff('entry_price', fill, start.fill)
  diff('open_fees', openFees, start.openFees)
  if (boughtBack) {
    diff('close_cost', buy, start.buy, cost)
    diff('close_fees', closeFees, start.closeFees)
  }
  const dirty = Object.keys(changes).length > 0

  const premium = (fillValue || 0) * p.contracts * 100
  const kept = premium - (moneyValue(openFees) || 0) - (boughtBack ? (cost || 0) + (moneyValue(closeFees) || 0) : 0)
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
        <MoneyField id="edit-fill" label="Sold per share" value={fill} onChange={setFill} error={fillError} />
        {showFees && <MoneyField id="edit-open-fees" label="Selling fees" value={openFees} onChange={setOpenFees} />}
        {boughtBack && <>
          <MoneyField id="edit-buy" label="Paid per share" value={buy} onChange={setBuy}
            hint={cost == null ? 'Not entered yet' : `${money(cost)} in total${oddCents ? '. Not a whole cent a share: if it includes the commission, enter the price your broker filled at' : ''}`} />
          {showFees && <MoneyField id="edit-close-fees" label="Buyback fees" value={closeFees} onChange={setCloseFees} />}
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
