// src/components/dialogs/RollModal.jsx — buy back an open call and sell a new one in one step
import { useState } from 'react'
import { apiError, rollPosition } from '../../api/client'
import Modal from './Modal'
import MoneyInput from '../MoneyInput'
import { fmtDate, money, plural } from '../../lib/format'
import { moneyValue } from '../../lib/pnl'

const todayIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function RollModal({ position: p, evaluation, onDone, onCancel }) {
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
    <Modal onDismiss={() => { if (!busy) onCancel() }}>
      <div className="card" role="dialog" aria-modal="true" aria-label="Roll this call"
        style={{ width: '100%', maxWidth: 520, padding: 28, animation: 'fadeUp 0.2s ease forwards' }}>
        <div style={{ fontWeight: 700, fontSize: 19, marginBottom: 4 }}>Roll this call</div>
        <div className="hint" style={{ marginBottom: 18 }}>
          Buy back the {money(p.strike)} {p.ticker} call (expires {fmtDate(p.expiry)}, {plural(p.contracts, 'contract')}) and sell a new one on the same shares.
          Enter what your broker filled.
        </div>

        <div className="section-title" style={{ fontSize: 15 }}>1. Buy back the current call</div>
        <div className="grid-2" style={{ gap: 12, marginTop: 8, marginBottom: 18 }}>
          <MoneyInput id="roll-cost" label="Paid to buy back (total)" value={costText} onChange={setCost} error={show('cost')}
            hint={estimate != null ? `Latest price check: ${money(estimate)}` : null} />
          <MoneyInput id="roll-close-fees" label="Fees (total)" value={closeFees} onChange={setCloseFees} />
        </div>

        <div className="section-title" style={{ fontSize: 15 }}>2. Sell the new call</div>
        <div className="grid-2" style={{ gap: 12, marginTop: 8 }}>
          <div>
            <label className="label" htmlFor="roll-expiry">New expiry</label>
            <input id="roll-expiry" className="input" type="date" min={todayIso()} value={expiry} onChange={e => setExpiry(e.target.value)}
              style={show('expiry') ? { borderColor: 'var(--red)' } : undefined} />
            {show('expiry') && <div style={{ color: 'var(--red)', fontSize: 12.5, marginTop: 5 }}>{show('expiry')}</div>}
          </div>
          <MoneyInput id="roll-strike" label="New strike" value={strikeText} onChange={setStrike} error={show('strike')} />
          <div>
            <label className="label" htmlFor="roll-contracts">Contracts</label>
            <input id="roll-contracts" className="input" type="text" inputMode="numeric" value={contractsText}
              onChange={e => setContracts(e.target.value.replace(/[^0-9]/g, ''))}
              style={show('contracts') ? { borderColor: 'var(--red)' } : undefined} />
            {show('contracts') && <div style={{ color: 'var(--red)', fontSize: 12.5, marginTop: 5 }}>{show('contracts')}</div>}
          </div>
          <MoneyInput id="roll-fill" label="Sold for (per share)" value={fillText} onChange={setFill} error={show('fill')} />
          <MoneyInput id="roll-open-fees" label="Fees (total)" value={openFees} onChange={setOpenFees} />
        </div>

        <div style={{ background: 'rgba(0,0,0,0.18)', borderRadius: 10, padding: '12px 14px', marginTop: 18, fontSize: 14, color: 'var(--text-dim)' }}>
          New premium {money(premium)} − buyback {money(cost || 0)}{fees ? ` − fees ${money(fees)}` : ''} ={' '}
          <strong style={{ color: net >= 0 ? 'var(--green)' : 'var(--red)' }}>{net >= 0 ? 'net credit' : 'net debit'} {money(Math.abs(net))}</strong>
        </div>

        {error && <div role="alert" style={{ marginTop: 12, color: 'var(--red)', fontSize: 13 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 20 }}>
          <button className="btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={busy}>
            {busy ? <><span className="spinner" /> Saving…</> : 'Save roll'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
