// src/components/dialogs/CloseModal.jsx — record how an open call ended: you bought it back, or shares were called away
import { useState } from 'react'
import { apiError, assignPosition, closePosition } from '../../api/client'
import Modal, { DialogHead } from './Modal'
import { MoneyField, Segmented, Spinner, UseHint } from '../ui'
import { useStrategy, chargesCommission } from '../../lib/useStrategy'
import { fmtDate, money, plural, strike } from '../../lib/format'
import { contractsTotal, moneyValue, usualFees } from '../../lib/pnl'

const HOW = [{ value: 'bought', label: 'Bought it back' }, { value: 'assigned', label: 'Shares called away' }]

export default function CloseModal({ position: p, evaluation, onDone, onCancel }) {
  const strategy = useStrategy()
  const showFees = chargesCommission(strategy)
  // The latest price check, offered as a hint: what you actually paid is on your broker's confirmation
  const priceNow = evaluation?.current_option_price > 0 ? evaluation.current_option_price : null
  const [how, setHow]         = useState('bought')   // 'bought' | 'assigned'
  const [priceText, setPrice] = useState('')
  const [feesText, setFees]   = useState(null)       // null until edited: your usual commission
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState(null)

  const price = moneyValue(priceText)
  const cost = price == null ? null : contractsTotal(price, p.contracts)
  const feesShown = feesText ?? (showFees ? usualFees(strategy, p.contracts) : '')
  const fees = moneyValue(feesShown)
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
      setError(apiError(e, 'Could not save this. Is the API running?'))
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
      <DialogHead id="close-title" title={how === 'assigned' ? 'Record an assignment' : 'Record a buyback'} onClose={onCancel} disabled={busy}
        sub={`${p.ticker} ${strike(p.strike)} call · expires ${fmtDate(p.expiry)} · ${plural(p.contracts, 'contract')}`} />
      <Segmented className="mt-5" label="What happened?" options={HOW} value={how} onChange={setHow} />

      {how === 'bought' ? (
        <>
          <div className={`mt-5 grid gap-3 ${showFees ? 'grid-cols-2' : ''}`}>
            <MoneyField id="close-price" label="Paid per share" value={priceText} onChange={setPrice}
              hint={priceNow != null && !priceText ? <UseHint label="Price now" value={priceNow} onUse={setPrice} /> : null} />
            {showFees && <MoneyField id="close-fees" label="Fees" value={feesShown} onChange={setFees}
              hint={feesText == null ? 'Your usual commission' : null} />}
          </div>
          <p className="mt-3 text-13 text-muted">
            The price on your broker's confirmation. No price yet? Save without it and add it later from History.
          </p>
          <dl className="mt-4 rounded-sm bg-panel px-4 py-1">
            {row('Collected', money(p.premium_total))}
            {row(cost != null ? `Bought back (${shares.toLocaleString()} × ${money(price)})` : 'Bought back', cost != null ? `−${money(cost)}` : '—')}
            {(openFees > 0 || fees > 0) && row('Fees, both ways', `−${money(openFees + (fees || 0))}`)}
            {row('You keep', cost != null ? money(kept) : '—', true)}
          </dl>
        </>
      ) : (
        <p className="mt-5 rounded-sm bg-panel px-4 py-3 text-15 text-fg-2">
          You keep the full <strong className="font-semibold text-fg">{money(p.premium_total)}</strong> premium.{' '}
          {shares.toLocaleString()} {p.ticker} shares come out of your holding, sold at {money(p.strike)}
          {shareGain != null && <> against your {money(p.cost_basis)} average cost: a <strong className="font-semibold text-fg">{money(Math.abs(shareGain))}</strong> {shareGain >= 0 ? 'profit' : 'loss'} on the shares</>}.
        </p>
      )}

      {error && <p role="alert" className="mt-3 text-13 text-loss">{error}</p>}
      <p className="mt-4 text-12 text-muted">This records what happened at your broker. Made a mistake? You can undo it from History.</p>
      <div className="dialog-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>
          {busy ? <><Spinner /> Saving…</> : 'Save'}
        </button>
      </div>
    </Modal>
  )
}
