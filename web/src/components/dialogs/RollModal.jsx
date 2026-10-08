// src/components/dialogs/RollModal.jsx — buy back an open call and sell a new one in one step
import { useState } from 'react'
import { apiError, rollPosition } from '../../api/client'
import Modal, { DialogHead } from './Modal'
import { Field, MoneyField, Spinner } from '../ui'
import { useStrategy, chargesCommission } from '../../lib/useStrategy'
import { fmtDate, money, plural, strike as strikeLabel } from '../../lib/format'
import { moneyValue } from '../../lib/pnl'

const todayIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const Step = ({ n, children }) => (
  <h3 className="mt-6 flex items-center gap-2.5 text-15 font-semibold">
    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-panel text-13 text-fg-2">{n}</span>{children}
  </h3>
)

export default function RollModal({ position: p, evaluation, onDone, onCancel }) {
  const showFees = chargesCommission(useStrategy())
  const estimate = evaluation?.current_option_price > 0 ? evaluation.cost_to_close : null
  const [costText, setCost]       = useState(estimate != null ? estimate.toFixed(2) : '')
  const [closeFees, setCloseFees] = useState('')
  const [expiry, setExpiry]       = useState('')
  const [strikeText, setStrike]   = useState(String(p.strike))
  const [contractsText, setContracts] = useState(String(p.contracts))
  const [fillText, setFill]       = useState('')
  const [openFees, setOpenFees]   = useState('')
  const [busy, setBusy]           = useState(false)
  const [error, setError]         = useState(null)
  const [tried, setTried]         = useState(false)

  const cost = moneyValue(costText)
  const strike = moneyValue(strikeText)
  const fill = moneyValue(fillText)
  const contracts = Number.parseInt(contractsText, 10)

  const errors = {
    cost:      cost == null ? 'Enter what you paid to buy it back' : null,
    expiry:    !expiry ? 'Pick the new expiry' : expiry <= todayIso() ? 'Must be after today' : null,
    strike:    !(strike > 0) ? 'Enter the new strike' : null,
    contracts: !(contracts >= 1) ? 'At least 1' : null,
    fill:      fill == null ? 'Enter the price you sold it for' : null,
  }
  const valid = Object.values(errors).every(e => !e)
  const show = k => (tried ? errors[k] : null)

  const premium = (fill || 0) * (contracts || 0) * 100
  const fees = (moneyValue(closeFees) || 0) + (moneyValue(openFees) || 0)
  const net = premium - (cost || 0) - fees

  const submit = async () => {
    setTried(true)
    if (!valid) return
    setBusy(true); setError(null)
    try {
      await rollPosition(p.id, {
        close_cost: cost, close_fees: moneyValue(closeFees) || 0,
        expiry, strike, contracts, entry_price: fill, open_fees: moneyValue(openFees) || 0,
      })
      onDone()
    } catch (e) {
      setError(apiError(e, 'Could not roll this call. Is the API running?'))
      setBusy(false)
    }
  }

  return (
    <Modal onDismiss={() => { if (!busy) onCancel() }} labelledBy="roll-title" width={540}>
      <DialogHead id="roll-title" title="Roll this call" onClose={onCancel} disabled={busy}
        sub={`Buy back the ${p.ticker} ${strikeLabel(p.strike)} call (${fmtDate(p.expiry)}, ${plural(p.contracts, 'contract')}) and sell a new one on the same shares.`} />

      <Step n={1}>Buy back the current call</Step>
      <div className={`mt-3 grid gap-3 ${showFees ? 'grid-cols-2' : ''}`}>
        <MoneyField id="roll-cost" label="Paid to buy back (total)" value={costText} onChange={setCost} error={show('cost')}
          hint={estimate != null ? `Latest price check: ${money(estimate)}` : null} />
        {showFees && <MoneyField id="roll-close-fees" label="Fees" value={closeFees} onChange={setCloseFees} />}
      </div>

      <Step n={2}>Sell the new call</Step>
      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-4">
        <Field id="roll-expiry" label="New expiry" type="date" min={todayIso()} value={expiry} onChange={e => setExpiry(e.target.value)} error={show('expiry')} />
        <MoneyField id="roll-strike" label="New strike" value={strikeText} onChange={setStrike} error={show('strike')} />
        <Field id="roll-contracts" label="Contracts" type="text" inputMode="numeric" value={contractsText}
          onChange={e => setContracts(e.target.value.replace(/[^0-9]/g, ''))} error={show('contracts')} />
        <MoneyField id="roll-fill" label="Sold for (per share)" value={fillText} onChange={setFill} error={show('fill')} />
        {showFees && <MoneyField id="roll-open-fees" label="Fees" value={openFees} onChange={setOpenFees} />}
      </div>

      <dl className="mt-5 rounded-sm bg-panel px-4 py-1">
        <div className="flex justify-between gap-3 border-b border-line-2 py-2"><dt className="text-fg-2">New premium</dt><dd>{money(premium)}</dd></div>
        <div className="flex justify-between gap-3 border-b border-line-2 py-2"><dt className="text-fg-2">Buyback{fees ? ' and fees' : ''}</dt><dd>−{money((cost || 0) + fees)}</dd></div>
        <div className="flex justify-between gap-3 py-2.5">
          <dt className="font-semibold">{net >= 0 ? 'Net credit' : 'Net debit'}</dt>
          <dd className="text-17 font-semibold" style={{ color: net >= 0 ? 'var(--accent)' : 'var(--loss)' }}>{money(Math.abs(net))}</dd>
        </div>
      </dl>

      {error && <p role="alert" className="mt-3 text-13 text-loss">{error}</p>}
      <div className="dialog-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>
          {busy ? <><Spinner /> Saving…</> : 'Save roll'}
        </button>
      </div>
    </Modal>
  )
}
