// src/pages/Scanner.jsx
import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { runScan, savePositions, apiError } from '../api/client'
import { useTicker } from '../context/TickerContext'
import { RotateCcw, ScanLine, AlertTriangle, TrendingUp, Scale, TrendingDown, CheckCircle2, ArrowRight, Moon } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import InfoTip from '../components/InfoTip'
import Collapsible from '../components/Collapsible'
import ServerDown from '../components/ServerDown'
import { TERMS } from '../lib/terms'
import { fmtDate, money, pct, plural } from '../lib/format'

const DEFAULT_CONFIG = {
  min_dte: 20, max_dte: 38,
  min_strike_pct: 0.20, min_premium: 0.05,
  min_volume: 10, min_open_interest: 50,
  target_delta: 0.22,
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
  { name: 'min_dte',           label: 'Shortest expiry (days)',      tip: TERMS.dte,         kind: 'int', min: 1,    max: 60 },
  { name: 'max_dte',           label: 'Longest expiry (days)',       tip: TERMS.dte,         kind: 'int', min: 1,    max: 120 },
  { name: 'min_strike_pct',    label: 'Min. distance above price',   tip: TERMS.minStrike,   kind: 'dec', min: 0.05, max: 0.5 },
  { name: 'min_premium',       label: 'Min. premium per share ($)',  tip: TERMS.minPremium,  kind: 'dec', min: 0.01, max: 1000 },
  { name: 'min_volume',        label: 'Min. daily volume',           tip: TERMS.volume,      kind: 'int', min: 1,    max: 1000000 },
  { name: 'min_open_interest', label: 'Min. open interest',          tip: TERMS.openInt,     kind: 'int', min: 1,    max: 1000000 },
  { name: 'target_delta',      label: 'Balanced pick target',        tip: TERMS.targetDelta, kind: 'dec', min: 0.05, max: 0.5 },
]

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
  if (config.max_dte < config.min_dte) { config.min_dte = DEFAULT_CONFIG.min_dte; config.max_dte = DEFAULT_CONFIG.max_dte }
  for (const t of TOGGLES) config[t.name] = saved[t.name] === true
  return config
}

const toForm = config => ({
  ...Object.fromEntries(FIELDS.map(f => [f.name, String(config[f.name])])),
  ...Object.fromEntries(TOGGLES.map(t => [t.name, !!config[t.name]])),
})

// Turn the typed text into numbers, with a plain message for each problem
function parseForm(form) {
  const values = Object.fromEntries(TOGGLES.map(t => [t.name, !!form[t.name]])), errors = {}
  for (const f of FIELDS) {
    const text = form[f.name]
    const v = Number(text)
    if (text === '' || text === '.') errors[f.name] = 'Enter a number'
    else if (!inRange(f, v)) errors[f.name] = `Must be ${f.kind === 'int' ? 'a whole number ' : ''}between ${f.min} and ${f.max.toLocaleString()}`
    else values[f.name] = v
  }
  if (!errors.min_dte && !errors.max_dte && values.max_dte < values.min_dte) {
    errors.max_dte = 'Must be at least the shortest expiry'
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
      <input
        id={id} type="text" className="input" autoComplete="off"
        inputMode={field.kind === 'int' ? 'numeric' : 'decimal'}
        value={text}
        aria-invalid={!!error} aria-describedby={error ? `${id}-err` : undefined}
        onChange={e => onChange(field.name, cleanInput(e.target.value, field.kind))}
        style={error ? { borderColor: 'var(--red)' } : undefined}
      />
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

// Earnings / ex-dividend before expiry
function EventBadges({ option }) {
  return <>
    {option.spans_earnings && <span className="badge badge-amber" title={TERMS.earnings}>Earnings</span>}
    {option.spans_ex_dividend && <span className="badge badge-blue" title={TERMS.exDividend}>Ex-div</span>}
  </>
}

function PickCard({ title, subtitle, icon: Icon, pick, accent, notInPlan, avgCost }) {
  if (!pick) return null
  const called = pick.delta != null ? `~${Math.round(pick.delta * 100)}%` : 'n/a'
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
        <Fact label="You collect (1 contract)" tip={TERMS.premium} value={money(pick.premium_per_contract ?? pick.premium_price * 100)} color="var(--green)" />
        <Fact label="Yearly return"            tip={TERMS.yield}   value={pct(pick.annualized_yield_pct)} />
        <Fact label="Room to rise"             tip={TERMS.upside}  value={pct(pick.upside_to_strike_pct)} />
        <Fact label="Chance of being called"   tip={TERMS.delta}   value={called} />
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
    } catch (e) {
      setError(apiError(e, 'Scan failed. Is the API running?'))
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    if (!result?.planned_positions) return
    const payload = result.planned_positions.map(p => ({
      ticker: result.ticker, expiry: p.expiry, strike: p.strike,
      contracts: p.contracts, entry_price: p.entry_price,
      premium_total: p.premium_total, allocation_type: p.allocation_type,
    }))
    setSaving(true)
    try { await savePositions(payload); setSaved(true) }
    catch (e) { setError(apiError(e, 'Could not save the trade. Is the API running?')) }
    finally { setSaving(false) }
  }

  const filterSummary = filtersValid
    ? `Calls expiring in ${config.min_dte}–${config.max_dte} days, with strikes at least ` +
      `${Math.round(config.min_strike_pct * 100)}% above today's price and paying at least ${money(config.min_premium)} per share.` +
      (config.exclude_below_cost ? ' Strikes below your average cost are skipped.' : '') +
      (config.avoid_earnings ? ' Expiries that span earnings are skipped.' : '')
    : 'One of the filters needs fixing before you can scan. Check the highlighted box under Adjust filters.'

  const planned = result?.planned_positions || []
  // Market closed: results use last traded prices, so saving waits for live prices
  const lastPrices = result?.quotes_live === false
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
        <div className="callout callout-amber">
          <AlertTriangle size={18} strokeWidth={1.75} /> <span>Add a stock you own on the <Link to="/" style={{ color: 'inherit', fontWeight: 700 }}>Dashboard</Link> to start scanning.</span>
        </div>
      )}

      {selected && (
        <>
          {/* Scan bar */}
          <div className="card" style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px 24px', flexWrap: 'wrap' }}>
              <div>
                <div className="section-title">What we'll look for</div>
                <div className="section-sub" style={{ maxWidth: 680, color: filtersValid ? undefined : 'var(--red)' }}>{filterSummary}</div>
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
                {(result.earnings_date || result.ex_dividend_date) && (
                  <span className="hint" style={{ display: 'block', marginTop: 4 }}>
                    {result.earnings_date && <>Next earnings: <strong style={{ color: 'var(--text-dim)' }}>{fmtDate(result.earnings_date)}</strong></>}
                    {result.earnings_date && result.ex_dividend_date && ' · '}
                    {result.ex_dividend_date && <>Next ex-dividend: <strong style={{ color: 'var(--text-dim)' }}>{fmtDate(result.ex_dividend_date)}</strong></>}
                  </span>
                )}
              </div>

              {lastPrices && (
                <div className="callout callout-amber" style={{ marginBottom: 20 }}>
                  <Moon size={18} strokeWidth={1.75} style={{ flexShrink: 0, marginTop: 1 }} />
                  <div>
                    <strong>The market is closed, so these are last traded prices, not live quotes.</strong>{' '}
                    Use them to plan. Prices will change when trading starts{nextOpen ? ` (${nextOpen} your time)` : ''}.
                    Scan again then to save a trade.
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
                      <div style={{ fontSize: 22, fontWeight: 700 }}>
                        Sell {plural(planned.reduce((s, p) => s + p.contracts, 0), 'call')} on {result.ticker}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div className="fact-label" style={{ justifyContent: 'flex-end' }}>{lastPrices ? 'Estimated at last prices' : 'You collect today'} <InfoTip text={TERMS.premium} size={12} align="right" /></div>
                      <div className="stat-num" style={{ color: 'var(--green)', fontSize: 30 }}>{money(result.gross_premium)}</div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
                    {planned.map((p, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px 16px', flexWrap: 'wrap', background: 'rgba(0,0,0,0.18)', borderRadius: 12, padding: '14px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                          <span className={`badge badge-${p.allocation_type === 'Income' ? 'accent' : 'blue'}`}>{p.allocation_type}</span>
                          <span style={{ fontSize: 15 }}>
                            Sell <strong>{plural(p.contracts, 'contract')}</strong> at the <strong>{money(p.strike)}</strong> strike, expiring <strong>{fmtDate(p.expiry)}</strong>
                          </span>
                          <span className="hint">({money(p.entry_price)} per share)</span>
                          {p.below_cost_basis && <BelowCostBadge />}
                          <EventBadges option={result.candidates.find(c => c.expiry === p.expiry && c.strike === p.strike) || {}} />
                        </div>
                        <span className="fact-value" style={{ color: 'var(--green)' }}>+{money(p.premium_total)}</span>
                      </div>
                    ))}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
                    <div className="facts" style={{ gridTemplateColumns: 'repeat(3, auto)', gap: '8px clamp(16px, 4vw, 40px)' }}>
                      <Fact label="Premium"                tip={TERMS.premium} value={money(result.gross_premium)} />
                      <Fact label="Set aside for buyback"  tip={TERMS.buyback} value={money(result.buyback_budget)} />
                      <Fact label="You keep"               value={money(result.net_premium)} color="var(--green)" />
                    </div>
                    {saved ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--green)', fontWeight: 600 }}>
                          <CheckCircle2 size={17} strokeWidth={1.75} /> Saved
                        </span>
                        <Link to="/positions" className="link-btn">View in Positions <ArrowRight size={15} /></Link>
                      </div>
                    ) : (
                      <button className="btn-primary" onClick={handleSave} disabled={saving || lastPrices}
                        title={lastPrices ? 'Available when the market is open and prices are live' : undefined}>
                        {saving ? <><span className="spinner" /> Saving…</> : 'Save this trade'}
                      </button>
                    )}
                  </div>
                  <div className="hint" style={{ marginTop: 14 }}>
                    {lastPrices
                      ? 'Saving is turned off until the market opens, so trades are never recorded at an out-of-date price.'
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
                    <PickCard title="Best for income" subtitle="Highest premium, closer to today's price." icon={TrendingUp} pick={result.income_pick} accent="#6ae4ff"
                      notInPlan={splitTarget.income === 0 ? "Your split puts all of this stock's contracts in balanced, so this is shown for reference only." : null} avgCost={result.avg_cost} />
                    <PickCard title="Best balance" subtitle="Less premium, more room for the stock to grow." icon={Scale} pick={result.balanced_pick} accent="#5aa9e6"
                      notInPlan={splitTarget.balanced === 0 ? "Your split puts all of this stock's contracts in income, so this is shown for reference only." : null} avgCost={result.avg_cost} />
                  </div>
                </>
              )}

              {/* 3. Everything else, on request */}
              {result.candidates.length > 0 && (
                <div className="card">
                  <Collapsible label={`See all ${plural(result.candidates.length, 'option')}`} openLabel="Hide the full list">
                    <div className="table-scroll">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Expires</th>
                            <th className="num">Days left</th>
                            <th className="num">Strike <InfoTip text={TERMS.strike} size={12} /></th>
                            <th className="num">Premium <InfoTip text={TERMS.premium} size={12} /></th>
                            <th className="num">Yearly return <InfoTip text={TERMS.yield} size={12} /></th>
                            <th className="num">Room to rise <InfoTip text={TERMS.upside} size={12} /></th>
                            <th className="num">Called chance <InfoTip text={TERMS.delta} size={12} /></th>
                            <th className="num">Spread <InfoTip text={TERMS.spread} size={12} /></th>
                            <th>Quote <InfoTip text={TERMS.quote} size={12} /></th>
                          </tr>
                        </thead>
                        <tbody>
                          {result.candidates.map((c, i) => (
                            <tr key={i}>
                              <td><span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>{fmtDate(c.expiry)} <EventBadges option={c} /></span></td>
                              <td className="mono num">{c.dte}</td>
                              <td className="mono num" style={{ color: c.below_cost_basis ? 'var(--amber)' : 'var(--text)', fontWeight: 600 }}
                                title={c.below_cost_basis ? 'Below your average cost' : undefined}>{c.below_cost_basis ? '▾ ' : ''}{money(c.strike)}</td>
                              <td className="mono num" style={{ color: 'var(--accent-light)' }}>{money(c.premium_price)}</td>
                              <td className="mono num">{pct(c.annualized_yield_pct)}</td>
                              <td className="mono num">{pct(c.upside_to_strike_pct)}</td>
                              <td className="mono num">{c.delta != null ? `${Math.round(c.delta * 100)}%` : 'n/a'}</td>
                              <td className="mono num">{pct(c.spread_pct)}</td>
                              <td><span className={`badge badge-${c.quote_quality === 'LIVE' ? 'green' : c.quote_quality === 'STALE' ? 'amber' : 'red'}`}>{c.quote_quality}</span></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Collapsible>
                </div>
              )}

              {result.candidates.length === 0 && (
                <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                  <TrendingDown size={24} strokeWidth={1.75} style={{ marginBottom: 12, opacity: 0.6 }} />
                  <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)', marginBottom: 8 }}>No options matched</div>
                  <div style={{ fontSize: 14, lineHeight: 1.7 }}>
                    Prices are only live during market hours <span style={{ color: 'var(--accent-light)' }}>(9:30am – 4:00pm ET, Mon – Fri)</span>.<br />
                    Outside those hours quotes go stale and get filtered out.<br />
                    Try again during trading hours, or loosen the filters above.
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
