// src/components/dialogs/AddCallModal.jsx — record a call by hand (sold outside the Scanner, or re-entering a corrected one)
import { useState } from 'react'
import { addPosition, apiError } from '../../api/client'
import Modal from './Modal'
import MoneyInput from '../MoneyInput'
import { money, plural } from '../../lib/format'
import { moneyValue } from '../../lib/pnl'

const isoToday = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function AddCallModal({ tickers, defaultTicker, onDone, onCancel }) {
  const [ticker, setTicker]   = useState(defaultTicker || tickers[0]?.ticker || '')
  const [type, setType]       = useState('Income')
  const [expiry, setExpiry]   = useState('')
  const [strike, setStrike]   = useState('')
  const [contractsText, setContracts] = useState('1')
  const [fill, setFill]       = useState('')
  const [fees, setFees]       = useState('')
  const [openedAt, setOpened] = useState(isoToday())
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState(null)
  const [tried, setTried]     = useState(false)

  const holding   = tickers.find(t => t.ticker === ticker)
  const free      = holding ? holding.total_contracts - holding.open_total : 0
  const contracts = Number.parseInt(contractsText, 10)
  const strikeV   = moneyValue(strike)
  const fillV     = moneyValue(fill)

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
        fees: moneyValue(fees) || 0, allocation_type: type, opened_at: openedAt,
      })
      onDone(ticker)
    } catch (e) {
      setError(apiError(e, 'Could not save this call. Is the API running?'))
      setBusy(false)
    }
  }

  const field = (id, label, input, err) => (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      {input}
      {err && <div style={{ color: 'var(--red)', fontSize: 12.5, marginTop: 5 }}>{err}</div>}
    </div>
  )
  const bad = k => (show(k) ? { borderColor: 'var(--red)' } : undefined)

  return (
    <Modal onBackdrop={() => { if (!busy) onCancel() }}>
      <div className="card" role="dialog" aria-modal="true" aria-label="Add a call"
        style={{ width: '100%', maxWidth: 520, padding: 28, animation: 'fadeUp 0.2s ease forwards' }}>
        <div style={{ fontWeight: 700, fontSize: 19, marginBottom: 4 }}>Add a call</div>
        <div className="hint" style={{ marginBottom: 18 }}>Record a covered call you sold with your broker. It's checked against your shares.</div>

        <div className="grid-2" style={{ gap: 12 }}>
          {field('add-ticker', 'Stock',
            <select id="add-ticker" className="input" value={ticker} onChange={e => setTicker(e.target.value)}>
              {tickers.map(t => <option key={t.ticker} value={t.ticker}>{t.ticker}</option>)}
            </select>,
            null)}
          {field('add-type', 'Type',
            <select id="add-type" className="input" value={type} onChange={e => setType(e.target.value)}>
              <option value="Income">Income</option>
              <option value="Balanced">Balanced</option>
            </select>,
            null)}
          {field('add-expiry', 'Expiry',
            <input id="add-expiry" className="input" type="date" value={expiry} onChange={e => setExpiry(e.target.value)} style={bad('expiry')} />,
            show('expiry'))}
          <MoneyInput id="add-strike" label="Strike" value={strike} onChange={setStrike} error={show('strike')} />
          {field('add-contracts', 'Contracts',
            <input id="add-contracts" className="input" type="text" inputMode="numeric" value={contractsText}
              onChange={e => setContracts(e.target.value.replace(/[^0-9]/g, ''))} style={bad('contracts')} />,
            show('contracts'))}
          <MoneyInput id="add-fill" label="Sold for (per share)" value={fill} onChange={setFill} error={show('fill')} />
          <MoneyInput id="add-fees" label="Fees (total)" value={fees} onChange={setFees} />
          {field('add-opened', 'Sold on',
            <input id="add-opened" className="input" type="date" max={isoToday()} value={openedAt} onChange={e => setOpened(e.target.value)} style={bad('openedAt')} />,
            show('openedAt'))}
        </div>

        <div className="hint" style={{ marginTop: 12 }}>
          {holding
            ? <>{ticker}: {plural(free, 'contract')} free to sell{fillV > 0 && contracts >= 1 ? <> · premium {money(fillV * contracts * 100)}</> : null}.</>
            : 'Add the stock on the Dashboard first.'}
        </div>
        {error && <div role="alert" style={{ marginTop: 10, color: 'var(--red)', fontSize: 13 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 20 }}>
          <button className="btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={busy || !holding}>
            {busy ? <><span className="spinner" /> Saving…</> : 'Add call'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
