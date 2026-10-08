// src/components/ui.jsx — the small building blocks every page uses. Styles live in
// index.css (.btn, .chip, .seg, .input …) and the Tailwind tokens (text-15, bg-surface …).
import { useId } from 'react'
import { useMarket } from '../context/MarketContext'
import { cleanMoney } from '../lib/pnl'

// The mark: a covered call's payoff, rising then capped at the strike
export function Logo({ size = 28 }) {
  return (
    <span className="inline-flex shrink-0 items-center justify-center bg-logo text-on-logo"
      style={{ width: size, height: size, borderRadius: size * 0.29 }} aria-hidden="true">
      <svg width={size * 0.64} height={size * 0.64} viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 18 11.5 9.5H20" /></svg>
    </span>
  )
}

export const Spinner = ({ className = '' }) => <span className={`spinner ${className}`} aria-hidden="true" />

// Small status dot: market open (accent), heads-up (amber), idle (grey)
export function Dot({ tone, className = '' }) {
  const bg = tone === 'accent' ? 'var(--accent)' : tone === 'amber' ? 'var(--amber)' : tone === 'loss' ? 'var(--loss)' : undefined
  return <span className={`dot ${className}`} style={bg ? { background: bg } : undefined} aria-hidden="true" />
}

export function MarketStatus({ className = '' }) {
  const { open } = useMarket()
  if (open == null) return null
  return (
    <span className={`inline-flex items-center gap-2 text-13 text-fg-2 ${className}`}>
      <Dot tone={open ? 'accent' : undefined} />{open ? 'Market open' : 'Market closed'}
    </span>
  )
}

// Pick one of a few: options = [{ value, label }]
export function Segmented({ options, value, onChange, label, large = false, className = '' }) {
  return (
    <div role="group" aria-label={label} className={`seg${large ? ' seg-lg' : ''} ${className}`}>
      {options.map(o => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  )
}

// A labelled text box, optionally with "$" before or "%" after it, and an ⓘ (tip) beside the label
export function Field({ id, label, tip, error, hint, prefix, suffix, className = '', inputClassName = '', ...input }) {
  const auto = useId()
  const fid = id || auto
  const note = error ? `${fid}-err` : hint ? `${fid}-hint` : undefined
  const box = (
    <input id={fid} className={`input ${inputClassName}`} aria-invalid={error ? true : undefined}
      aria-describedby={note} autoComplete="off" {...input} />
  )
  return (
    <div className={className}>
      {label && (tip
        ? <div className="label flex items-center gap-1.5"><label htmlFor={fid}>{label}</label>{tip}</div>
        : <label className="label" htmlFor={fid}>{label}</label>)}
      {prefix || suffix ? (
        <span className={`affix${suffix && !prefix ? ' affix-end' : ''}`}>
          {prefix && <span className="affix-before" aria-hidden="true">{prefix}</span>}
          {box}
          {suffix && <span className="affix-after" aria-hidden="true">{suffix}</span>}
        </span>
      ) : box}
      {error ? <div id={note} className="field-error">{error}</div>
        : hint ? <div id={note} className="field-hint">{hint}</div> : null}
    </div>
  )
}

// "$ 12.50": digits and one dot, two decimals at most
export function MoneyField({ onChange, placeholder = '0.00', ...rest }) {
  return <Field prefix="$" type="text" inputMode="decimal" placeholder={placeholder} onChange={e => onChange(cleanMoney(e.target.value))} {...rest} />
}

export function Switch({ checked, onChange, label, disabled }) {
  return (
    <button type="button" role="switch" className="switch" aria-checked={!!checked} aria-label={label}
      disabled={disabled} onClick={() => onChange(!checked)}>
      <span />
    </button>
  )
}

// How much of a call's premium you've kept, with the buy-back target marked
export function KeptBar({ pct, target, event = false, hot = false, height = 6, className = '' }) {
  const w = Math.max(0, Math.min(pct || 0, 100))
  return (
    <div className={`relative rounded-full bg-track ${className}`} style={{ height }} aria-hidden="true">
      <div className="h-full rounded-full" style={{ width: `${w}%`, background: hot ? 'var(--accent)' : 'var(--text-2)' }} />
      {target > 0 && (
        <span className="absolute rounded-sm" title={`Target: ${target.toFixed(1)}% kept`}
          style={{ left: `${Math.min(target, 100)}%`, top: -4, bottom: -4, width: 2, marginLeft: -1, background: event ? 'var(--amber)' : 'var(--mark)' }} />
      )}
    </div>
  )
}

// A number with its label: "In open calls  $5,033.30  6 calls"
export function Stat({ label, value, sub, className = '' }) {
  return (
    <div className={className}>
      <div className="text-13 text-muted">{label}</div>
      <div className="mt-1 text-22 font-semibold tracking-title">{value}</div>
      {sub && <div className="mt-0.5 text-13 text-muted">{sub}</div>}
    </div>
  )
}

// Grey placeholder shape while data loads
export const Bone = ({ className = '', style }) => <span className={`skeleton ${className}`} style={style} />
