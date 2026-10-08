// src/components/dialogs/CloseModal.jsx — close an open call: bought back, or shares called away
import { useState } from 'react'
import { apiError, assignPosition, closePosition } from '../../api/client'
import Modal, { DialogHead } from './Modal'
import { MoneyField, Segmented, Spinner } from '../ui'
import { useStrategy, chargesCommission } from '../../lib/useStrategy'
import { fmtDate, money, plural, strike } from '../../lib/format'
import { moneyValue } from '../../lib/pnl'

const HOW = [{ value: 'bought', label: 'Bought it back' }, { value: 'assigned', label: 'Shares called away' }]

export default function CloseModal({ position: p, evaluation, onDone, onCancel }) {
  const showFees = chargesCommission(useStrategy())
  // Pre-fill with the estimate from the latest price check when there is one
  const estimate = evaluation?.current_option_price > 0 ? evaluation.cost_to_close : null
  const [how, setHow]         = useState('bought')   // 'bought' | 'assigned'
  const [costText, setCost]   = useState(estimate != null ? estimate.toFixed(2) : '')
  const [feesText, setFees]   = useState('')
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState(null)

  const cost = moneyValue(costText)
  const fees = moneyValue(feesText)
  const openFees = p.open_fees || 0
  const kept = p.premium_total - openFees - (cost || 0) - (fees || 0)
  const shares = p.contracts * 100
  const shareGain = p.cost_basis ? (p.strike - p.cost_basis) * shares : null

  const submit = async () => {
    setBusy(true); setError(null)
    try {
      if (how === 'assigned') await assignPosition(p.id)
      else await closePosition(p.id, cost, fees)
      onDone(how)
    } catch (e) {
      setError(apiError(e, 'Could not close this call. Is the API running?'))
      setBusy(false)
    }
  }

  const row = (label, value, strong) => (
    <div className={`flex justify-between gap-3 py-2 ${strong ? 'py-2.5' : 'border-b border-line-2'}`}>
      <dt className={strong ? 'font-semibold' : 'text-fg-2'}>{label}</dt>
      <dd className={strong ? 'text-17 font-semibold' : ''} style={strong ? { color: kept >= 0 ? 'var(--accent)' : 'var(--loss)' } : undefined}>{value}</dd>
    </div>
  )

  return (
    <Modal onDismiss={() => { if (!busy) onCancel() }} labelledBy="close-title" width={480}>
      <DialogHead id="close-title" title="Close this call" onClose={onCancel} disabled={busy}
        sub={`${p.ticker} ${strike(p.strike)} call · expires ${fmtDate(p.expiry)} · ${plural(p.contracts, 'contract')}`} />
      <Segmented className="mt-5" label="How did it close?" options={HOW} value={how} onChange={setHow} />

      {how === 'bought' ? (
        <>
          <div className={`mt-5 grid gap-3 ${showFees ? 'grid-cols-2' : ''}`}>
            <MoneyField id="close-cost" label="Paid to buy back (total)" value={costText} onChange={setCost} />
            {showFees && <MoneyField id="close-fees" label="Fees" value={feesText} onChange={setFees} />}
          </div>
          <p className="field-hint">
            {estimate != null ? `Filled in from the latest price check (${money(estimate)}). ` : ''}Optional, but it keeps your results right.
          </p>
          <dl className="mt-4 rounded-sm bg-panel px-4 py-1">
            {row('Collected', money(p.premium_total))}
            {row('Bought back', cost != null ? `−${money(cost)}` : '—')}
            {(openFees > 0 || fees > 0) && row('Fees, both ways', `−${money(openFees + (fees || 0))}`)}
            {row('You keep', money(kept), true)}
          </dl>
        </>
      ) : (
        <p className="mt-5 rounded-sm bg-panel px-4 py-3 text-15 text-fg-2">
          You keep the full <strong className="font-semibold text-fg">{money(p.premium_total)}</strong> premium.{' '}
          {shares.toLocaleString()} {p.ticker} shares come out of your holding, sold at {money(p.strike)}
          {shareGain != null && <> against your {money(p.cost_basis)} average cost: a <strong className="font-semibold text-fg">{money(Math.abs(shareGain))}</strong> {shareGain >= 0 ? 'gain' : 'loss'} on the shares</>}.
        </p>
      )}

      {error && <p role="alert" className="mt-3 text-13 text-loss">{error}</p>}
      <p className="mt-4 text-12 text-muted">Made a mistake? You can undo this from History.</p>
      <div className="dialog-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>
          {busy ? <><Spinner /> Saving…</> : how === 'assigned' ? 'Record assignment' : 'Mark closed'}
        </button>
      </div>
    </Modal>
  )
}
