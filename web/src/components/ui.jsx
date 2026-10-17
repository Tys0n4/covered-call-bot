// src/components/ui.jsx — the small building blocks every page uses. Styles live in
// index.css (.btn, .chip, .seg, .input …) and the Tailwind tokens (text-15, bg-surface …).
import { useId } from 'react'
import { useMarket } from '../context/MarketContext'
import { cleanMoney } from '../lib/pnl'
import { money } from '../lib/format'

// The mark: a crescent moon (Home's moon fills as you reach your goal)
export function Logo({ size = 26 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className="shrink-0" aria-hidden="true">
      <circle cx="16" cy="16" r="12" fill="var(--logo)" />
      <circle cx="21" cy="12" r="10.5" fill="var(--on-logo)" />
    </svg>
  )
}

// A moon lit by how much is done: the month's goal reached, a call's premium kept. It waxes from
// the right; `empty` draws a dashed outline (nothing to measure), `ring` circles a full one.
export function Moon({ pct, size = 40, label, empty = false, ring = false, className = '' }) {
  const f = Math.max(0, Math.min(pct || 0, 100)) / 100
  const r = ring ? 41 : 46
  const rx = (r * Math.abs(1 - 2 * f)).toFixed(2)
  const lit = f > 0 && f < 1 ? `M50 ${50 - r} A${r} ${r} 0 0 1 50 ${50 + r} A${rx} ${r} 0 0 ${f > 0.5 ? 1 : 0} 50 ${50 - r} Z` : null
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={`shrink-0 ${className}`}
      role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {ring && <circle cx="50" cy="50" r="48" fill="none" stroke="var(--gold)" strokeWidth="2.5" opacity="0.6" />}
      {empty
        ? <circle cx="50" cy="50" r={r} fill="none" stroke="var(--moon-edge)" strokeWidth="2.5" strokeDasharray="7 8" />
        : <circle cx="50" cy="50" r={r} fill={f >= 1 ? 'var(--gold)' : 'var(--moon)'} stroke={f >= 1 ? 'none' : 'var(--moon-edge)'} strokeWidth="1.5" />}
      {lit && !empty && <path d={lit} fill="var(--gold)" />}
    </svg>
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

// Under a price box: a price CovCall knows, offered rather than filled in ("Price now $0.64 · Use")
export function UseHint({ label, value, onUse }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5">
      {label} {money(value)} <span aria-hidden="true">·</span>
      <button type="button" className="link link-quiet text-13" onClick={() => onUse(value.toFixed(2))} aria-label={`Use ${money(value)}`}>Use</button>
    </span>
  )
}

export function Switch({ checked, onChange, label, disabled }) {
  return (
    <button type="button" role="switch" className="switch" aria-checked={!!checked} aria-label={label}
      disabled={disabled} onClick={() => onChange(!checked)}>
      <span />
    </button>
  )
}

// How much of a call's premium you've kept (gold, it's money), with the buy-back target marked:
// ink normally, periwinkle when an earnings date or Fed decision lowered it
export function KeptBar({ pct, target, event = false, height = 4, className = '' }) {
  const w = Math.max(0, Math.min(pct || 0, 100))
  return (
    <div className={`relative rounded-full bg-track ${className}`} style={{ height }} aria-hidden="true">
      <div className="h-full rounded-full" style={{ width: `${w}%`, background: 'var(--gold)' }} />
      {target > 0 && (
        <span className="absolute rounded-sm" title={`Target: ${target.toFixed(1)}% kept`}
          style={{ left: `${Math.min(target, 100)}%`, top: -5, bottom: -5, width: 2, marginLeft: -1, background: event ? 'var(--amber)' : 'var(--mark)' }} />
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
