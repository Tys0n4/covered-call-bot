// src/components/MoneyInput.jsx — "$ 12.50" text box (digits and one dot)
import { cleanMoney } from '../lib/pnl'

export default function MoneyInput({ id, label, value, onChange, placeholder = '0.00', error, hint }) {
  return (
    <div>
      {label && <label className="label" htmlFor={id}>{label}</label>}
      <div style={{ position: 'relative' }}>
        <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}>$</span>
        <input id={id} className="input" type="text" inputMode="decimal" autoComplete="off" placeholder={placeholder}
          value={value} onChange={e => onChange(cleanMoney(e.target.value))}
          aria-invalid={!!error} aria-describedby={error ? `${id}-err` : undefined}
          style={{ paddingLeft: 28, ...(error ? { borderColor: 'var(--red)' } : {}) }} />
      </div>
      {error && <div id={`${id}-err`} style={{ color: 'var(--red)', fontSize: 12.5, marginTop: 5 }}>{error}</div>}
      {!error && hint && <div className="hint" style={{ marginTop: 5 }}>{hint}</div>}
    </div>
  )
}
