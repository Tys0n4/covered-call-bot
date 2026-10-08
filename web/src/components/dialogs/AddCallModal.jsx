// src/components/dialogs/AddCallModal.jsx — record a call by hand (sold outside the Scanner, or re-entering a corrected one)
import { useState } from 'react'
import { addPosition, apiError } from '../../api/client'
import Modal, { DialogHead } from './Modal'
import { Field, MoneyField, Segmented, Spinner } from '../ui'
import { useStrategy, chargesCommission } from '../../lib/useStrategy'
import { money, plural } from '../../lib/format'
import { moneyValue, usualFees } from '../../lib/pnl'

const isoToday = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const TYPES = [{ value: 'Income', label: 'Income' }, { value: 'Balanced', label: 'Balanced' }]

export default function AddCallModal({ tickers, defaultTicker, onDone, onCancel }) {
  const strategy = useStrategy()
  const showFees = chargesCommission(strategy)
  const [ticker, setTicker]   = useState(defaultTicker || tickers[0]?.ticker || '')
  const [type, setType]       = useState('Income')
  const [expiry, setExpiry]   = useState('')
  const [strike, setStrike]   = useState('')
  const [contractsText, setContracts] = useState('1')
  const [fill, setFill]       = useState('')
  const [fees, setFees]       = useState(null)    // null until edited: your usual commission
  const [openedAt, setOpened] = useState(isoToday())
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState(null)
  const [tried, setTried]     = useState(false)

  const holding   = tickers.find(t => t.ticker === ticker)
  const free      = holding ? holding.total_contracts - holding.open_total : 0
  const contracts = Number.parseInt(contractsText, 10)
  const strikeV   = moneyValue(strike)
  const fillV     = moneyValue(fill)
  const feesShown = fees ?? (showFees ? usualFees(strategy, contracts) : '')

  const errors = {
    expiry:    !expiry ? 'Pick the expiry' : expiry < openedAt ? 'Must be on or after the day you sold it' : null,
    strike:    !(strikeV > 0) ? 'Enter the strike' : null,
    contracts: !(contracts >= 1) ? 'At least 1' : contracts > free ? `Only ${free} free` : null,
    fill:      !(fillV > 0) ? 'Enter the price you sold at' : null,
    openedAt:  !openedAt ? 'Pick a date' : openedAt > isoToday() ? "Can't be in the future" : null,
  }
  const valid = Object.values(errors).every(e => !e)
  const show = k => (tried ? errors[k] : null)

  const submit = async () => {
    setTried(true)
    if (!valid) return
    setBusy(true); setError(null)
    try {
      await addPosition({
        ticker, expiry, strike: strikeV, contracts, entry_price: fillV,
        fees: moneyValue(feesShown) || 0, allocation_type: type, opened_at: openedAt,
      })
      onDone(ticker)
    } catch (e) {
      setError(apiError(e, 'Could not save this call. Is the API running?'))
      setBusy(false)
    }
  }

  return (
    <Modal onDismiss={() => { if (!busy) onCancel() }} labelledBy="add-title" width={540}>
      <DialogHead id="add-title" title="Add a call" sub="Record a covered call you sold with your broker." onClose={onCancel} disabled={busy} />

      <div className="mt-5 grid grid-cols-2 gap-x-3 gap-y-4">
        <div>
          <label className="label" htmlFor="add-ticker">Stock</label>
          <select id="add-ticker" className="input" value={ticker} onChange={e => setTicker(e.target.value)}>
            {tickers.map(t => <option key={t.ticker} value={t.ticker}>{t.ticker}</option>)}
          </select>
        </div>
        <div>
          <span className="label" id="add-type">Type</span>
          <Segmented label="Type" options={TYPES} value={type} onChange={setType} />
        </div>
        <Field id="add-expiry" label="Expiry" type="date" value={expiry} onChange={e => setExpiry(e.target.value)} error={show('expiry')} />
        <MoneyField id="add-strike" label="Strike" value={strike} onChange={setStrike} error={show('strike')} />
        <Field id="add-contracts" label="Contracts" type="text" inputMode="numeric" value={contractsText}
          onChange={e => setContracts(e.target.value.replace(/[^0-9]/g, ''))} error={show('contracts')} />
        <MoneyField id="add-fill" label="Sold per share" value={fill} onChange={setFill} error={show('fill')} />
        <Field id="add-opened" label="Sold on" type="date" max={isoToday()} value={openedAt} onChange={e => setOpened(e.target.value)} error={show('openedAt')} />
        {showFees && <MoneyField id="add-fees" label="Fees" value={feesShown} onChange={setFees} hint={fees == null ? 'Your usual commission' : null} />}
      </div>

      <p className={`mt-4 rounded-sm bg-panel px-4 py-3 text-15 ${holding && free > 0 ? 'text-fg-2' : 'text-loss'}`}>
        {!holding ? 'Add the stock on Home first.'
          : free === 0 ? `${ticker} has no free contracts. Every share is already covered.`
          : <>{ticker}: {plural(free, 'contract')} free{fillV > 0 && contracts >= 1 ? <> · premium {money(fillV * contracts * 100)}</> : null}</>}
      </p>
      {error && <p role="alert" className="mt-3 text-13 text-loss">{error}</p>}
      <div className="dialog-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={submit} disabled={busy || !holding || free === 0}>
          {busy ? <><Spinner /> Saving…</> : 'Add call'}
        </button>
      </div>
    </Modal>
  )
}
