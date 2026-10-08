// src/components/dialogs/RollModal.jsx — record a roll: you bought back an open call and sold a new one on the same shares
import { useState } from 'react'
import { apiError, rollPosition } from '../../api/client'
import Modal, { DialogHead } from './Modal'
import { Field, MoneyField, Spinner, UseHint } from '../ui'
import { useStrategy, chargesCommission } from '../../lib/useStrategy'
import { fmtDate, money, plural, strike as strikeLabel } from '../../lib/format'
import { contractsTotal, moneyValue, usualFees } from '../../lib/pnl'

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
  const strategy = useStrategy()
  const showFees = chargesCommission(strategy)
  const priceNow = evaluation?.current_option_price > 0 ? evaluation.current_option_price : null
  const [buyText, setBuy]         = useState('')
  const [closeFees, setCloseFees] = useState(null)     // null until edited: your usual commission
  const [expiry, setExpiry]       = useState('')
  const [strikeText, setStrike]   = useState(String(p.strike))
  const [contractsText, setContracts] = useState(String(p.contracts))
  const [fillText, setFill]       = useState('')
  const [openFees, setOpenFees]   = useState(null)
  const [busy, setBusy]           = useState(false)
  const [error, setError]         = useState(null)
  const [tried, setTried]         = useState(false)

  const buy = moneyValue(buyText)
  const strike = moneyValue(strikeText)
  const fill = moneyValue(fillText)
  const contracts = Number.parseInt(contractsText, 10)
  const closeFeesShown = closeFees ?? (showFees ? usualFees(strategy, p.contracts) : '')
  const openFeesShown = openFees ?? (showFees ? usualFees(strategy, contracts) : '')

  const errors = {
    buy:       buy == null ? 'Enter the price you bought it back at' : null,
    expiry:    !expiry ? 'Pick the new expiry' : expiry <= todayIso() ? 'Must be after today' : null,
    strike:    !(strike > 0) ? 'Enter the new strike' : null,
    contracts: !(contracts >= 1) ? 'At least 1' : null,
    fill:      fill == null ? 'Enter the price you sold it at' : null,
  }
  const valid = Object.values(errors).every(e => !e)
  const show = k => (tried ? errors[k] : null)

  const cost = contractsTotal(buy || 0, p.contracts)
  const premium = contractsTotal(fill || 0, contracts || 0)
  const fees = (moneyValue(closeFeesShown) || 0) + (moneyValue(openFeesShown) || 0)
  const net = premium - cost - fees

  const submit = async () => {
    setTried(true)
    if (!valid) return
    setBusy(true); setError(null)
    try {
      await rollPosition(p.id, {
        close_cost: cost, close_fees: moneyValue(closeFeesShown) || 0,
        expiry, strike, contracts, entry_price: fill, open_fees: moneyValue(openFeesShown) || 0,
      })
      onDone()
    } catch (e) {
      setError(apiError(e, 'Could not save this roll. Is the API running?'))
      setBusy(false)
    }
  }

  const row = (label, value) => (
    <div className="flex justify-between gap-3 border-b border-line-2 py-2"><dt className="text-fg-2">{label}</dt><dd>{value}</dd></div>
  )

  return (
    <Modal onDismiss={() => { if (!busy) onCancel() }} labelledBy="roll-title" width={540}>
      <DialogHead id="roll-title" title="Record a roll" onClose={onCancel} disabled={busy}
        sub={`You bought back the ${p.ticker} ${strikeLabel(p.strike)} call (${fmtDate(p.expiry)}, ${plural(p.contracts, 'contract')}) and sold a new one on the same shares. Enter the prices from your broker.`} />

      <Step n={1}>The call you bought back</Step>
      <div className={`mt-3 grid gap-3 ${showFees ? 'grid-cols-2' : ''}`}>
        <MoneyField id="roll-buy" label="Paid per share" value={buyText} onChange={setBuy} error={show('buy')}
          hint={priceNow != null && !buyText ? <UseHint label="Price now" value={priceNow} onUse={setBuy} /> : null} />
        {showFees && <MoneyField id="roll-close-fees" label="Buyback fees" value={closeFeesShown} onChange={setCloseFees}
          hint={closeFees == null ? 'Your usual commission' : null} />}
      </div>

      <Step n={2}>The new call you sold</Step>
      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-4">
        <Field id="roll-expiry" label="New expiry" type="date" min={todayIso()} value={expiry} onChange={e => setExpiry(e.target.value)} error={show('expiry')} />
        <MoneyField id="roll-strike" label="New strike" value={strikeText} onChange={setStrike} error={show('strike')} />
        <Field id="roll-contracts" label="Contracts" type="text" inputMode="numeric" value={contractsText}
          onChange={e => setContracts(e.target.value.replace(/[^0-9]/g, ''))} error={show('contracts')} />
        <MoneyField id="roll-fill" label="Sold per share" value={fillText} onChange={setFill} error={show('fill')} />
        {showFees && <MoneyField id="roll-open-fees" label="New call fees" value={openFeesShown} onChange={setOpenFees}
          hint={openFees == null ? 'Your usual commission' : null} />}
      </div>

      <dl className="mt-5 rounded-sm bg-panel px-4 py-1">
        {row('New premium', fill == null || !(contracts >= 1) ? '—' : money(premium))}
        {row('Buyback', buy == null ? '—' : `−${money(cost)}`)}
        {fees > 0 && row('Fees, both trades', `−${money(fees)}`)}
        <div className="flex justify-between gap-3 py-2.5">
          <dt className="font-semibold">{buy == null || fill == null || net >= 0 ? 'Net credit' : 'Net debit'}</dt>
          {buy == null || fill == null
            ? <dd className="text-17 font-semibold text-muted">—</dd>
            : <dd className="text-17 font-semibold" style={{ color: net >= 0 ? 'var(--accent)' : 'var(--loss)' }}>{money(Math.abs(net))}</dd>}
        </div>
      </dl>

      {error && <p role="alert" className="mt-3 text-13 text-loss">{error}</p>}
      <p className="mt-4 text-12 text-muted">This records the roll you made at your broker. Made a mistake? You can undo it from History.</p>
      <div className="dialog-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>
          {busy ? <><Spinner /> Saving…</> : 'Save'}
        </button>
      </div>
    </Modal>
  )
}
