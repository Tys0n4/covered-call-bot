// src/pages/Scanner.jsx
import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { runScan, savePositions, apiError } from '../api/client'
import { useStrategy, chargesCommission } from '../lib/useStrategy'
import RangeMeter from '../components/RangeMeter'
import { SOURCE_LABEL } from '../lib/source'
import { useTicker } from '../context/TickerContext'
import { RotateCcw, ScanLine, AlertTriangle, TrendingUp, Scale, TrendingDown, CheckCircle2, ArrowRight, Moon } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import InfoTip from '../components/InfoTip'
import Collapsible from '../components/Collapsible'
import MoneyInput from '../components/MoneyInput'
import ServerDown from '../components/ServerDown'
import EmptyState, { AddStockLink } from '../components/EmptyState'
import OptionsTable, { EventBadges } from '../components/OptionsTable'
import PremiumCheck, { GoalCheck } from '../components/PremiumCheck'
import { TERMS } from '../lib/terms'
import { fmtDate, money, pct, plural } from '../lib/format'
import { moneyValue, splitFees } from '../lib/pnl'

// The expiry window and delta range come from your strategy (Strategy page)
const DEFAULT_CONFIG = {
  min_strike_pct: 0, min_premium: 0.05,
  min_volume: 10, min_open_interest: 50,
  exclude_below_cost: false,
  avoid_earnings: false,
}

// On/off filters (checkboxes), saved alongside the number boxes
const TOGGLES = [
  { name: 'exclude_below_cost', label: 'Skip strikes below my average cost', tip: TERMS.belowCost },
  { name: 'avoid_earnings',     label: 'Skip expiries that span earnings',  tip: TERMS.earnings },
]

const STORAGE_KEY = 'scanner_config'

// The filter boxes: what each accepts and the allowed range
const FIELDS = [
  { name: 'min_strike_pct',    label: 'Min. distance above price (optional)', tip: TERMS.minStrike, kind: 'dec', min: 0, max: 0.5, pct: true },
  { name: 'min_premium',       label: 'Min. premium per share ($)',  tip: TERMS.minPremium,  kind: 'dec', min: 0.01, max: 1000 },
  { name: 'min_volume',        label: 'Min. daily volume',           tip: TERMS.volume,      kind: 'int', min: 1,    max: 1000000 },
  { name: 'min_open_interest', label: 'Min. open interest',          tip: TERMS.openInt,     kind: 'int', min: 1,    max: 1000000 },
]
// Fields with pct: true are typed as percentages (20 = 20%) but stored and
// sent to the API as fractions (0.20), with min/max in stored units.
const toShown = (f, v) => (f.pct ? String(Math.round(v * 10000) / 100) : String(v))
const fromShown = (f, text) => (f.pct ? Number(text) / 100 : Number(text))
const shownLimit = (f, v) => (f.pct ? `${Math.round(v * 100)}%` : v.toLocaleString())

const inRange = (f, v) => Number.isFinite(v) && v >= f.min && v <= f.max && (f.kind !== 'int' || Number.isInteger(v))

// Saved filters from this browser. Anything missing or invalid (e.g. a box
// that was left empty before this fix) falls back to the default.
function loadConfig() {
  let saved
  try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {} } catch { saved = {} }
  const config = { ...DEFAULT_CONFIG }
  for (const f of FIELDS) {
    const v = Number(saved[f.name])
    if (saved[f.name] !== null && saved[f.name] !== '' && inRange(f, v)) config[f.name] = v
  }
  for (const t of TOGGLES) config[t.name] = saved[t.name] === true
  return config
}

const toForm = config => ({
  ...Object.fromEntries(FIELDS.map(f => [f.name, toShown(f, config[f.name])])),
  ...Object.fromEntries(TOGGLES.map(t => [t.name, !!config[t.name]])),
})

// Turn the typed text into numbers, with a plain message for each problem
function parseForm(form) {
  const values = Object.fromEntries(TOGGLES.map(t => [t.name, !!form[t.name]])), errors = {}
  for (const f of FIELDS) {
    const text = form[f.name]
    const v = fromShown(f, text)
    if (text === '' || text === '.') errors[f.name] = 'Enter a number'
    else if (!inRange(f, v)) errors[f.name] = `Must be ${f.kind === 'int' ? 'a whole number ' : ''}between ${shownLimit(f, f.min)} and ${shownLimit(f, f.max)}`
    else values[f.name] = v
  }
  return { values, errors, valid: Object.keys(errors).length === 0 }
}

// Keep only what a box can hold: digits, plus one dot for decimals.
// Leading zeros are dropped so typing over a 0 replaces it.
function cleanInput(raw, kind) {
  if (kind === 'int') return raw.replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '')
  let t = raw.replace(/[^0-9.]/g, '')
  const dot = t.indexOf('.')
  if (dot !== -1) t = t.slice(0, dot + 1) + t.slice(dot + 1).replace(/\./g, '')
  return t.replace(/^0+(?=\d)/, '')
}

function Field({ field, text, error, onChange }) {
  const id = `f-${field.name}`
  return (
    <div>
      <label className="label" htmlFor={id}>{field.label} <InfoTip text={field.tip} /></label>
      <div style={{ position: 'relative' }}>
        <input
          id={id} type="text" className="input" autoComplete="off"
          inputMode={field.kind === 'int' ? 'numeric' : 'decimal'}
          value={text}
          aria-invalid={!!error} aria-describedby={error ? `${id}-err` : undefined}
          onChange={e => onChange(field.name, cleanInput(e.target.value, field.kind))}
          style={{ ...(field.pct ? { paddingRight: 32 } : {}), ...(error ? { borderColor: 'var(--red)' } : {}) }}
        />
        {field.pct && <span aria-hidden="true" style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}>%</span>}
      </div>
      {error && <div id={`${id}-err`} style={{ color: 'var(--red)', fontSize: 12.5, marginTop: 5 }}>{error}</div>}
    </div>
  )
}

function Fact({ label, tip, value, color }) {
  return (
    <div>
      <div className="fact-label">{label} <InfoTip text={tip} size={12} /></div>
      <div className="fact-value" style={color ? { color } : undefined}>{value}</div>
    </div>
  )
}

function BelowCostBadge() {
  return <span className="badge badge-amber" title={TERMS.belowCost}>Below your cost</span>
}

function PickCard({ title, subtitle, icon: Icon, pick, accent, notInPlan, avgCost, range }) {
  if (!pick) return null
  return (
    <div className="card" style={{ flex: 1, borderColor: notInPlan ? 'var(--border)' : `${accent}33` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: notInPlan ? 'var(--text-muted)' : accent, fontWeight: 700, fontSize: 15 }}>
        <Icon size={16} strokeWidth={2} /> {title}
        {notInPlan && <span className="badge" style={{ marginLeft: 'auto', background: 'rgba(255,255,255,0.06)', color: 'var(--text-dim)', border: '1px solid var(--border)' }}>Not in your plan</span>}
      </div>
      <div className="hint" style={{ marginBottom: 16 }}>{notInPlan || subtitle}</div>
      <div style={notInPlan ? { opacity: 0.55 } : undefined}>
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: pick.below_cost_basis ? 8 : 16 }}>
        {money(pick.strike)} strike <span className="muted" style={{ fontWeight: 500, fontSize: 15 }}>· expires {fmtDate(pick.expiry)}</span>
      </div>
      {(pick.spans_earnings || pick.spans_ex_dividend) && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}><EventBadges option={pick} /></div>
      )}
      {pick.below_cost_basis && (
        <div className="hint" style={{ color: 'var(--amber)', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <BelowCostBadge /> {money(avgCost - pick.strike)}/share loss on your shares if they're called away.
        </div>
      )}
      <div className="facts" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Fact label="You collect (1 contract)" tip={TERMS.premium} value={money(pick.net_per_contract ?? pick.premium_per_contract)} color="var(--green)" />
        <Fact label="Yearly return"            tip={TERMS.yield}   value={pct(pick.annualized_yield_pct)} />
        <Fact label="Room to rise"             tip={TERMS.upside}  value={pct(pick.upside_to_strike_pct)} />
      </div>
      <div style={{ marginTop: 18 }}>
        <RangeMeter delta={pick.delta} min={range?.min} max={range?.max} color={accent} />
      </div>
      </div>
    </div>
  )
}

function HowItWorks() {
  const steps = [
    ['Scan', 'We look at call options on your shares that match your filters.'],
    ['Pick', 'You get one pick for income and one balanced pick, plus a recommended trade.'],
    ['Track', 'Save the trade and follow it on the Positions page until you close it.'],
  ]
  return (
    <div className="card" style={{ marginTop: 24 }}>
      <div className="section-title" style={{ marginBottom: 16 }}>How it works</div>
      <div className="grid-steps">
        {steps.map(([t, d], i) => (
          <div key={t} style={{ display: 'flex', gap: 12 }}>
            <div style={{ width: 28, height: 28, borderRadius: 99, background: 'var(--accent-dim)', color: 'var(--accent-light)', fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i + 1}</div>
            <div>
              <div style={{ fontWeight: 700, marginBottom: 2 }}>{t}</div>
              <div className="hint">{d}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function Scanner() {
  const { selected, loaded, loadError, refresh } = useTicker()
  const [form, setForm]       = useState(() => toForm(loadConfig()))   // boxes, exactly as typed
  const [result, setResult]   = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)
  const [saved, setSaved]     = useState(false)
  const [saving, setSaving]   = useState(false)
  const [fills, setFills]     = useState([])   // per-share fill for each planned leg, as typed
  const [feesText, setFees]   = useState('')   // total commissions for the trade, as typed
  const strategy = useStrategy()          // delta range, expiry window and commission
  const showFees = chargesCommission(strategy)

  const { values: config, errors: fieldErrors, valid: filtersValid } = parseForm(form)

  // Remember filters in this browser, but only once every box is valid
  useEffect(() => {
    if (!filtersValid) return
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(config)) } catch { /* storage unavailable */ }
  }, [form]) // eslint-disable-line react-hooks/exhaustive-deps

  // Clear the last scan when you switch stocks
  const [scannedFor, setScannedFor] = useState(selected)
  if (scannedFor !== selected) {
    setScannedFor(selected); setResult(null); setError(null); setSaved(false)
  }

  const updateField = (k, text) => setForm(f => ({ ...f, [k]: text }))

  const handleScan = async () => {
    if (!selected || !filtersValid) return
    setLoading(true); setError(null); setResult(null); setSaved(false)
    try {
      const res = await runScan({ ...config, ticker: selected })
      setResult(res.data)
      setFills(res.data.planned_positions.map(p => p.entry_price.toFixed(2)))
      // Your usual commission for these contracts; edit it if your broker charged something else
      setFees(res.data.estimated_fees > 0 ? res.data.estimated_fees.toFixed(2) : '')
    } catch (e) {
      setError(apiError(e, 'Scan failed. Is the API running?'))
    } finally {
      setLoading(false)
    }
  }

  const fillValues = fills.map(moneyValue)
  const fillsValid = fillValues.length > 0 && fillValues.every(v => v != null && v > 0)

  const handleSave = async () => {
    if (!result?.planned_positions || !fillsValid) return
    const legs = result.planned_positions
    const fees = splitFees(moneyValue(feesText) || 0, legs.map(p => p.contracts))
    const payload = legs.map((p, i) => ({
      ticker: result.ticker, expiry: p.expiry, strike: p.strike,
      contracts: p.contracts, entry_price: fillValues[i],
      allocation_type: p.allocation_type, fees: fees[i],
    }))
    setSaving(true)
    try { await savePositions(payload); setSaved(true) }
    catch (e) { setError(apiError(e, 'Could not save the trade. Is the API running?')) }
    finally { setSaving(false) }
  }

  const rules = strategy ? `Calls with a ${Math.round(strategy.delta_min * 100)}–${Math.round(strategy.delta_max * 100)}% chance of being called, expiring in ${strategy.min_dte}–${strategy.max_dte} days` : 'Calls in your strategy'
  const filterSummary = filtersValid
    ? `${rules}, paying at least ${money(config.min_premium)} per share` +
      (config.min_strike_pct > 0 ? `, with strikes at least ${Math.round(config.min_strike_pct * 100)}% above today's price.` : '.') +
      (config.exclude_below_cost ? ' Strikes below your average cost are skipped.' : '') +
      (config.avoid_earnings ? ' Expiries that span earnings are skipped.' : '')
    : 'One of the filters needs fixing before you can scan. Check the highlighted box under Adjust filters.'

  const planned = result?.planned_positions || []
  // Market closed (or opened under 15 min ago, while the delayed quotes catch up):
  // results use last-session prices, so saving waits for live prices
  const lastPrices = result?.quotes_live === false
  const liveAt = lastPrices && result?.quotes_live_at
    ? new Date(result.quotes_live_at).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' })
    : null
  const scanRange = result ? { min: result.delta_min, max: result.delta_max } : null
  const optionFor = p => result?.candidates.find(c => c.expiry === p.expiry && c.strike === p.strike) || {}
  const nextOpen = result?.next_market_open
    ? new Date(result.next_market_open).toLocaleString('en-CA', { weekday: 'long', hour: 'numeric', minute: '2-digit' })
    : null
  // Which side of your split this stock actually uses (from your Strategy split)
  const summary = result?.allocation_summary || {}
  const splitTarget = summary.total_contracts > 0
    ? { income: summary.target_income, balanced: summary.target_balanced }
    : { income: null, balanced: null }

  return (
    <div className="fade-up">
      <PageHeader
        title="Scanner"
        showTicker
        subtitle={selected ? `Find a covered call to sell on your ${selected} shares.` : 'Find a covered call to sell on your shares.'}
      />

      {!selected && loadError && <ServerDown onRetry={() => refresh().catch(() => {})} />}

      {!selected && loaded && !loadError && (
        <EmptyState icon={ScanLine} title="Add a stock to start scanning" action={<AddStockLink />}>
          The Scanner looks for covered calls on shares you own. Add a stock and how many shares you have, then come back here.
        </EmptyState>
      )}

      {selected && (
        <>
          {/* Scan bar */}
          <div className="card" style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px 24px', flexWrap: 'wrap' }}>
              <div>
                <div className="section-title">What we'll look for</div>
                <div className="section-sub" style={{ maxWidth: 680, color: filtersValid ? undefined : 'var(--red)' }}>{filterSummary}{' '}
                  <Link to="/strategy" style={{ color: 'var(--accent-light)', whiteSpace: 'nowrap' }}>Edit strategy</Link></div>
              </div>
              <button className="btn-primary" onClick={handleScan} disabled={loading || !filtersValid} style={{ padding: '13px 28px', fontSize: 15, flexShrink: 0 }}>
                {loading ? <><span className="spinner" /> Scanning…</> : <><ScanLine size={17} strokeWidth={2} /> Scan {selected}</>}
              </button>
            </div>
            <div className="divider" style={{ margin: '18px 0 10px' }} />
            <Collapsible
              label="Adjust filters"
              openLabel="Hide filters"
              right={
                <button className="link-btn" style={{ color: 'var(--text-muted)', fontSize: 13 }} onClick={() => setForm(toForm(DEFAULT_CONFIG))}>
                  <RotateCcw size={13} strokeWidth={1.75} /> Reset to defaults
                </button>
              }
            >
              <div className="grid-filters">
                {FIELDS.map(f => (
                  <Field key={f.name} field={f} text={form[f.name]} error={fieldErrors[f.name]} onChange={updateField} />
                ))}
              </div>
              <div style={{ display: 'flex', gap: '10px 28px', flexWrap: 'wrap', marginTop: 18 }}>
                {TOGGLES.map(t => (
                  <label key={t.name} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: 'var(--text-dim)', cursor: 'pointer' }}>
                    <input type="checkbox" checked={form[t.name]} onChange={e => updateField(t.name, e.target.checked)}
                      style={{ width: 16, height: 16, accentColor: 'var(--accent)' }} />
                    {t.label} <InfoTip text={t.tip} />
                  </label>
                ))}
              </div>
            </Collapsible>
          </div>

          {error && (
            <div className="callout callout-red" style={{ marginBottom: 20 }}>
              <AlertTriangle size={18} strokeWidth={1.75} /> {error}
            </div>
          )}

          {loading && (
            <div className="card" style={{ textAlign: 'center', padding: 60 }}>
              <div className="spinner" style={{ width: 40, height: 40, margin: '0 auto 16px' }} />
              <div style={{ fontSize: 15, fontWeight: 600 }}>Checking {selected} options…</div>
              <div className="hint" style={{ marginTop: 6 }}>This usually takes 15–30 seconds.</div>
            </div>
          )}

          {result && !loading && (
            <>
              <div style={{ fontSize: 15, color: 'var(--text-dim)', marginBottom: 20 }}>
                <strong style={{ color: 'var(--text)' }}>{result.ticker}</strong> {lastPrices ? 'last traded at' : 'is trading at'}{' '}
                <strong style={{ color: 'var(--text)' }}>{money(result.current_price)}</strong>.{' '}
                {plural(result.candidates.length, 'option')} matched your filters.
                {SOURCE_LABEL[result.data_source] && (
                  <span className="hint" style={{ display: 'block', marginTop: 4 }}>
                    {result.price_source === 'cboe' && result.data_source === 'cboe' ? 'Stock and option prices' : 'Option prices'}: {SOURCE_LABEL[result.data_source]}
                  </span>
                )}
                {(result.earnings_date || result.ex_dividend_date) && (
                  <span className="hint" style={{ display: 'block', marginTop: 4 }}>
                    {result.earnings_date && <>Next earnings: <strong style={{ color: 'var(--text-dim)' }}>{fmtDate(result.earnings_date)}</strong></>}
                    {result.earnings_date && result.ex_dividend_date && ' · '}
                    {result.ex_dividend_date && <>Next ex-dividend: <strong style={{ color: 'var(--text-dim)' }}>{fmtDate(result.ex_dividend_date)}</strong></>}
                  </span>
                )}
              </div>
              <GoalCheck check={result.goal_check} deltaMax={result.delta_max} />
              <PremiumCheck check={result.premium_check} />

              {lastPrices && (
                <div className="callout callout-amber" style={{ marginBottom: 20 }}>
                  <Moon size={18} strokeWidth={1.75} style={{ flexShrink: 0, marginTop: 1 }} />
                  <div>
                    {liveAt ? <>
                      <strong>Trading just opened, but option prices are about 15 minutes behind, so these are still the last session's closing prices.</strong>{' '}
                      Scan again after {liveAt} your time to see today's prices and save a trade.
                    </> : <>
                      <strong>The market is closed, so these are the last session's closing prices, not live quotes.</strong>{' '}
                      Use them to plan. Prices will change when trading starts{nextOpen ? ` (${nextOpen} your time)` : ''}.
                      Scan again then to save a trade.
                    </>}
                  </div>
                </div>
              )}

              {result.warnings?.length > 0 && (
                <div className="callout callout-amber" style={{ marginBottom: 20, flexDirection: 'column', gap: 6 }}>
                  {result.warnings.map((w, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <AlertTriangle size={15} strokeWidth={1.75} /> {w}
                    </div>
                  ))}
                </div>
              )}

              {/* 1. The recommendation */}
              {planned.length > 0 && (
                <div className="rec-card" style={{ marginBottom: 24 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px 24px', marginBottom: 20, flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-light)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                        Recommended trade
                        {lastPrices && <span className="badge badge-amber">Last prices</span>}
                      </div>
                      <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700 }}>
                        Sell {plural(planned.reduce((s, p) => s + p.contracts, 0), 'call')} on {result.ticker}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div className="fact-label" style={{ justifyContent: 'flex-end' }}>{lastPrices ? 'Estimated at last prices' : 'You collect today'} <InfoTip text={TERMS.premium} size={12} /></div>
                      <div className="stat-num" style={{ color: 'var(--green)', fontSize: 30 }}>{money(result.gross_premium)}</div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
                    {planned.map((p, i) => (
                      <div key={i} className="rec-leg">
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px 16px', flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                          <span className={`badge badge-${p.allocation_type === 'Income' ? 'accent' : 'violet'}`}>{p.allocation_type}</span>
                          <span style={{ fontSize: 15 }}>
                            Sell <strong>{plural(p.contracts, 'contract')}</strong> at the <strong>{money(p.strike)}</strong> strike, expiring <strong>{fmtDate(p.expiry)}</strong>
                          </span>
                          <span className="hint">({money(p.entry_price)} per share)</span>
                          {p.below_cost_basis && <BelowCostBadge />}
                          <EventBadges option={optionFor(p)} />
                        </div>
                        <span className="fact-value" style={{ color: 'var(--green)' }}>+{money(p.premium_total)}</span>
                        </div>
                        <RangeMeter delta={optionFor(p).delta} min={scanRange.min} max={scanRange.max}
                          color={p.allocation_type === 'Income' ? 'var(--accent)' : 'var(--violet)'} />
                      </div>
                    ))}
                  </div>

                  {!saved && !lastPrices && (
                    <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginBottom: 20 }}>
                      <div className="fact-label" style={{ marginBottom: 10 }}>
                        Your fills <InfoTip text={TERMS.fill} size={12} />
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
                        {planned.map((p, i) => (
                          <MoneyInput key={i} id={`fill-${i}`} label={`${p.allocation_type} · ${money(p.strike)} (per share)`}
                            value={fills[i] ?? ''} onChange={v => setFills(f => f.map((x, j) => (j === i ? v : x)))}
                            error={fillValues[i] == null || !(fillValues[i] > 0) ? 'Enter the price you sold at' : null} />
                        ))}
                        {showFees && <MoneyInput id="fill-fees" label="Fees (total)" value={feesText} onChange={setFees} />}
                      </div>
                      {fillsValid && (
                        <div className="hint" style={{ marginTop: 8 }}>
                          At these fills you collect{' '}
                          <strong style={{ color: 'var(--green)' }}>
                            {money(planned.reduce((s, p, i) => s + fillValues[i] * p.contracts * 100, 0) - (moneyValue(feesText) || 0))}
                          </strong>{showFees ? ' after fees' : ''}.
                        </div>
                      )}
                    </div>
                  )}

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
                    <div className="facts" style={{ gridTemplateColumns: 'repeat(3, auto)', gap: '8px clamp(16px, 4vw, 40px)' }}>
                      <Fact label="Premium"                tip={TERMS.premium} value={money(result.gross_premium)} />
                      <Fact label="Set aside for buyback"  tip={TERMS.buyback} value={money(result.buyback_budget)} />
                      <Fact label="You keep"               tip={TERMS.keep} value={money(result.net_premium)} color="var(--green)" />
                    </div>
                    {saved ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--green)', fontWeight: 600 }}>
                          <CheckCircle2 size={17} strokeWidth={1.75} /> Saved
                        </span>
                        <Link to="/positions" className="link-btn">View in Positions <ArrowRight size={15} /></Link>
                      </div>
                    ) : (
                      <button className="btn-primary" onClick={handleSave} disabled={saving || lastPrices || !fillsValid}
                        title={lastPrices ? (liveAt ? `Available after ${liveAt}, once prices catch up` : 'Available when the market is open and prices are live') : undefined}>
                        {saving ? <><span className="spinner" /> Saving…</> : 'Save this trade'}
                      </button>
                    )}
                  </div>
                  <div className="hint" style={{ marginTop: 14 }}>
                    {lastPrices
                      ? `Saving is turned off until ${liveAt ? `prices catch up at ${liveAt}` : 'the market opens'}, so trades are never recorded at an out-of-date price.`
                      : 'Saving records the trade here so you can track it. It does not place an order with your broker.'}
                  </div>
                </div>
              )}

              {planned.length === 0 && result.candidates.length > 0 && (
                <div className="callout callout-green" style={{ marginBottom: 24 }}>
                  <CheckCircle2 size={18} strokeWidth={1.75} />
                  All of your {result.ticker} contracts are already working, so there is nothing new to sell. The best options are below for reference.
                </div>
              )}

              {/* 2. The two picks */}
              {(result.income_pick || result.balanced_pick) && (
                <>
                  <div className="section-title" style={{ marginBottom: 12 }}>Top picks</div>
                  <div className="pick-row" style={{ marginBottom: 24 }}>
                    <PickCard title="Best for income" subtitle="Highest premium, closer to today's price." icon={TrendingUp} pick={result.income_pick} accent="#2fc8ee" range={scanRange}
                      notInPlan={splitTarget.income === 0 ? "Your split puts all of this stock's contracts in balanced, so this is shown for reference only." : null} avgCost={result.avg_cost} />
                    <PickCard title="Best balance" subtitle="Less premium, more room for the stock to grow." icon={Scale} pick={result.balanced_pick} accent="#a495ff" range={scanRange}
                      notInPlan={splitTarget.balanced === 0 ? "Your split puts all of this stock's contracts in income, so this is shown for reference only." : null} avgCost={result.avg_cost} />
                  </div>
                </>
              )}

              {/* 3. Everything else, on request */}
              {result.candidates.length > 0 && (
                <div className="card">
                  <Collapsible label={`See all ${plural(result.candidates.length, 'option')}`} openLabel="Hide the full list">
                    <OptionsTable candidates={result.candidates} />
                  </Collapsible>
                </div>
              )}

              {result.candidates.length === 0 && (
                <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                  <TrendingDown size={24} strokeWidth={1.75} style={{ marginBottom: 12, opacity: 0.6 }} />
                  <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)', marginBottom: 8 }}>No options matched</div>
                  <div style={{ fontSize: 14, lineHeight: 1.7, maxWidth: 520, margin: '0 auto' }}>
                    None of the {result.ticker} calls expiring in {result.min_dte}–{result.max_dte} days with
                    a {Math.round(result.delta_min * 100)}–{Math.round(result.delta_max * 100)}% chance of being called passed every filter.
                    Try a wider range or expiry window on the <Link to="/strategy" style={{ color: 'var(--accent-light)' }}>Strategy</Link> page,
                    or under <strong style={{ color: 'var(--text-dim)' }}>Adjust filters</strong> a lower minimum premium, volume or open interest
                    {config.min_strike_pct > 0 ? `, or a smaller distance above price (now ${Math.round(config.min_strike_pct * 100)}%)` : ''}.
                    {lastPrices && <><br />Options are priced at the last session's closing quote, or their last trade when there isn't one. Ones that haven't traded recently have no price and are skipped.</>}
                  </div>
                </div>
              )}
            </>
          )}

          {!result && !loading && !error && <HowItWorks />}
        </>
      )}
    </div>
  )
}
