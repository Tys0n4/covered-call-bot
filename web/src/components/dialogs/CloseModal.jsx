// src/components/dialogs/CloseModal.jsx — close an open call: bought back, or shares called away
import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { apiError, assignPosition, closePosition } from '../../api/client'
import Modal from './Modal'
import MoneyInput from '../MoneyInput'
import { fmtDate, money, plural } from '../../lib/format'
import { moneyValue } from '../../lib/pnl'

export default function CloseModal({ position: p, evaluation, onDone, onCancel }) {
  // Pre-fill with the estimate from "Check prices" when there is one
  const estimate = evaluation?.current_option_price > 0 ? evaluation.cost_to_close : null
  const [how, setHow]         = useState('bought')   // 'bought' | 'assigned'
  const [costText, setCost]   = useState(estimate != null ? estimate.toFixed(2) : '')
  const [feesText, setFees]   = useState('')
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState(null)

  const cost = moneyValue(costText)
  const fees = moneyValue(feesText)
  const kept = p.premium_total - (p.open_fees || 0) - (cost || 0) - (fees || 0)
  const shares = p.contracts * 100

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

  const option = (value, title, hint) => (
    <label className={`choice${how === value ? ' active' : ''}`}>
      <input type="radio" name="how" value={value} checked={how === value} onChange={() => setHow(value)} />
      <span><strong>{title}</strong><span className="hint" style={{ display: 'block' }}>{hint}</span></span>
    </label>
  )

  return (
    <Modal onDismiss={() => { if (!busy) onCancel() }}>
      <div className="card" role="dialog" aria-modal="true" aria-label="Close this call"
        style={{ width: '100%', maxWidth: 460, padding: 28, animation: 'fadeUp 0.2s ease forwards' }}>
        <div style={{ fontWeight: 700, fontSize: 19, marginBottom: 12 }}>Close this call</div>
        <div style={{ background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px', marginBottom: 16 }}>
          <div style={{ fontWeight: 700 }}>{p.ticker} · {money(p.strike)} call</div>
          <div className="hint" style={{ marginTop: 4 }}>Expires {fmtDate(p.expiry)} · {plural(p.contracts, 'contract')} · {p.allocation_type}</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          {option('bought', 'I bought it back', 'You paid to close the option with your broker.')}
          {option('assigned', 'My shares were called away', `The buyer exercised, so ${shares.toLocaleString()} ${p.ticker} shares were sold at ${money(p.strike)}.`)}
        </div>

        {how === 'bought' ? (
          <>
            <div className="grid-2" style={{ gap: 12 }}>
              <MoneyInput id="close-cost" label="Paid to buy it back (total)" value={costText} onChange={setCost} />
              <MoneyInput id="close-fees" label="Fees (total)" value={feesText} onChange={setFees} />
            </div>
            <div className="hint" style={{ marginTop: 8 }}>
              {estimate != null ? `Filled in from the latest price check (${money(estimate)}). ` : ''}
              Optional, but it keeps your results accurate. Collected {money(p.premium_total)}
              {cost != null ? <>, so you keep <strong style={{ color: kept >= 0 ? 'var(--green)' : 'var(--red)' }}>{money(kept)}</strong></> : ''}.
            </div>
          </>
        ) : (
          <div className="callout callout-amber" style={{ fontSize: 13 }}>
            <AlertTriangle size={16} strokeWidth={1.75} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>You keep the full {money(p.premium_total)} premium. This removes {shares.toLocaleString()} shares from your {p.ticker} holding
              {p.cost_basis ? <> and records the sale at {money(p.strike)} against your {money(p.cost_basis)} average cost</> : ''}.</span>
          </div>
        )}

        {error && <div role="alert" style={{ marginTop: 12, color: 'var(--red)', fontSize: 13 }}>{error}</div>}
        <div className="hint" style={{ marginTop: 12 }}>Made a mistake? You can undo this from History.</div>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 18 }}>
          <button className="btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={busy}>
            {busy ? <><span className="spinner" /> Saving…</> : how === 'assigned' ? 'Record assignment' : 'Mark closed'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
