// src/pages/Scanner.jsx
import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { runScan, savePositions } from '../api/client'
import { useTicker } from '../context/TickerContext'
import { RotateCcw, ScanLine, AlertTriangle, TrendingUp, Scale, TrendingDown, CheckCircle2, ArrowRight } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import InfoTip from '../components/InfoTip'
import Collapsible from '../components/Collapsible'
import { TERMS } from '../lib/terms'
import { fmtDate, money, pct, plural } from '../lib/format'

const DEFAULT_CONFIG = {
  min_dte: 20, max_dte: 38,
  min_strike_pct: 0.20, min_premium: 0.05,
  min_volume: 10, min_open_interest: 50,
  income_weight: 0.70, target_delta: 0.22,
}

const STORAGE_KEY = 'scanner_config'

function loadConfig() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved ? { ...DEFAULT_CONFIG, ...JSON.parse(saved) } : DEFAULT_CONFIG
  } catch { return DEFAULT_CONFIG }
}

function Field({ label, tip, name, value, onChange, step = 1, min, max }) {
  return (
    <div>
      <label className="label" htmlFor={`f-${name}`}>{label} <InfoTip text={tip} /></label>
      <input
        id={`f-${name}`} type="number" className="input" step={step}
        min={min} max={max} value={value}
        onChange={e => onChange(name, parseFloat(e.target.value))}
      />
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

function PickCard({ title, subtitle, icon: Icon, pick, accent }) {
  if (!pick) return null
  const called = pick.delta != null ? `~${Math.round(pick.delta * 100)}%` : 'n/a'
  return (
    <div className="card" style={{ flex: 1, borderColor: `${accent}33` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: accent, fontWeight: 700, fontSize: 15 }}>
        <Icon size={16} strokeWidth={2} /> {title}
      </div>
      <div className="hint" style={{ marginBottom: 16 }}>{subtitle}</div>
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>
        {money(pick.strike)} strike <span className="muted" style={{ fontWeight: 500, fontSize: 15 }}>· expires {fmtDate(pick.expiry)}</span>
      </div>
      <div className="facts" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Fact label="You collect (1 contract)" tip={TERMS.premium} value={money(pick.premium_per_contract ?? pick.premium_price * 100)} color="var(--green)" />
        <Fact label="Yearly return"            tip={TERMS.yield}   value={pct(pick.annualized_yield_pct)} />
        <Fact label="Room to rise"             tip={TERMS.upside}  value={pct(pick.upside_to_strike_pct)} />
        <Fact label="Chance of being called"   tip={TERMS.delta}   value={called} />
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24 }}>
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
  const { selected } = useTicker()
  const [config, setConfig]   = useState(loadConfig)
  const [result, setResult]   = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)
  const [saved, setSaved]     = useState(false)
  const [saving, setSaving]   = useState(false)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  }, [config])

  // Clear the last scan when you switch stocks
  const [scannedFor, setScannedFor] = useState(selected)
  if (scannedFor !== selected) {
    setScannedFor(selected); setResult(null); setError(null); setSaved(false)
  }

  const updateConfig = (k, v) => setConfig(c => ({ ...c, [k]: v }))

  const handleScan = async () => {
    if (!selected) return
    setLoading(true); setError(null); setResult(null); setSaved(false)
    try {
      const res = await runScan({ ...config, ticker: selected })
      setResult(res.data)
    } catch (e) {
      setError(e.response?.data?.detail || 'Scan failed. Is the API running?')
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
    catch { setError('Could not save the trade. Is the API running?') }
    finally { setSaving(false) }
  }

  const filterSummary =
    `Calls expiring in ${config.min_dte}–${config.max_dte} days, with strikes at least ` +
    `${Math.round((config.min_strike_pct || 0) * 100)}% above today's price and paying at least ${money(config.min_premium)} per share.`

  const planned = result?.planned_positions || []

  return (
    <div className="fade-up">
      <PageHeader
        title="Scanner"
        showTicker
        subtitle={selected ? `Find a covered call to sell on your ${selected} shares.` : 'Find a covered call to sell on your shares.'}
      />

      {!selected && (
        <div className="callout callout-amber">
          <AlertTriangle size={18} strokeWidth={1.75} /> <span>Add a stock you own on the <Link to="/" style={{ color: 'inherit', fontWeight: 700 }}>Dashboard</Link> to start scanning.</span>
        </div>
      )}

      {selected && (
        <>
          {/* Scan bar */}
          <div className="card" style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 24 }}>
              <div>
                <div className="section-title">What we'll look for</div>
                <div className="section-sub" style={{ maxWidth: 680 }}>{filterSummary}</div>
              </div>
              <button className="btn-primary" onClick={handleScan} disabled={loading} style={{ padding: '13px 28px', fontSize: 15, flexShrink: 0 }}>
                {loading ? <><span className="spinner" /> Scanning…</> : <><ScanLine size={17} strokeWidth={2} /> Scan {selected}</>}
              </button>
            </div>
            <div className="divider" style={{ margin: '18px 0 10px' }} />
            <Collapsible
              label="Adjust filters"
              openLabel="Hide filters"
              right={
                <button className="link-btn" style={{ color: 'var(--text-muted)', fontSize: 13 }} onClick={() => setConfig(DEFAULT_CONFIG)}>
                  <RotateCcw size={13} strokeWidth={1.75} /> Reset to defaults
                </button>
              }
            >
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20 }}>
                <Field label="Shortest expiry (days)" tip={TERMS.dte}         name="min_dte"           value={config.min_dte}           onChange={updateConfig} min={1} max={60} />
                <Field label="Longest expiry (days)"  tip={TERMS.dte}         name="max_dte"           value={config.max_dte}           onChange={updateConfig} min={1} max={120} />
                <Field label="Min. distance above price" tip={TERMS.minStrike} name="min_strike_pct"   value={config.min_strike_pct}    onChange={updateConfig} step={0.01} min={0.05} max={0.5} />
                <Field label="Min. premium per share ($)" tip={TERMS.minPremium} name="min_premium"    value={config.min_premium}       onChange={updateConfig} step={0.01} min={0.01} />
                <Field label="Min. daily volume"      tip={TERMS.volume}      name="min_volume"        value={config.min_volume}        onChange={updateConfig} min={1} />
                <Field label="Min. open interest"     tip={TERMS.openInt}     name="min_open_interest" value={config.min_open_interest} onChange={updateConfig} min={1} />
                <Field label="Balanced pick target"   tip={TERMS.targetDelta} name="target_delta"      value={config.target_delta}      onChange={updateConfig} step={0.01} min={0.05} max={0.5} />
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
                <strong style={{ color: 'var(--text)' }}>{result.ticker}</strong> is trading at{' '}
                <strong style={{ color: 'var(--text)' }}>{money(result.current_price)}</strong>.{' '}
                {plural(result.candidates.length, 'option')} matched your filters.
              </div>

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
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 24, marginBottom: 20 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-light)', marginBottom: 6 }}>Recommended trade</div>
                      <div style={{ fontSize: 22, fontWeight: 700 }}>
                        Sell {plural(planned.reduce((s, p) => s + p.contracts, 0), 'call')} on {result.ticker}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div className="fact-label" style={{ justifyContent: 'flex-end' }}>You collect today <InfoTip text={TERMS.premium} size={12} align="right" /></div>
                      <div className="stat-num" style={{ color: 'var(--green)', fontSize: 30 }}>{money(result.gross_premium)}</div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
                    {planned.map((p, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, background: 'rgba(0,0,0,0.18)', borderRadius: 12, padding: '14px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                          <span className={`badge badge-${p.allocation_type === 'Income' ? 'accent' : 'blue'}`}>{p.allocation_type}</span>
                          <span style={{ fontSize: 15 }}>
                            Sell <strong>{plural(p.contracts, 'contract')}</strong> at the <strong>{money(p.strike)}</strong> strike, expiring <strong>{fmtDate(p.expiry)}</strong>
                          </span>
                          <span className="hint">({money(p.entry_price)} per share)</span>
                        </div>
                        <span className="fact-value" style={{ color: 'var(--green)' }}>+{money(p.premium_total)}</span>
                      </div>
                    ))}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
                    <div className="facts" style={{ gridTemplateColumns: 'repeat(3, auto)', gap: '8px 40px' }}>
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
                      <button className="btn-primary" onClick={handleSave} disabled={saving}>
                        {saving ? <><span className="spinner" /> Saving…</> : 'Save this trade'}
                      </button>
                    )}
                  </div>
                  <div className="hint" style={{ marginTop: 14 }}>
                    Saving records the trade here so you can track it. It does not place an order with your broker.
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
                  <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
                    <PickCard title="Best for income" subtitle="Highest premium, closer to today's price." icon={TrendingUp} pick={result.income_pick} accent="#6ae4ff" />
                    <PickCard title="Best balance" subtitle="Less premium, more room for the stock to grow." icon={Scale} pick={result.balanced_pick} accent="#5aa9e6" />
                  </div>
                </>
              )}

              {/* 3. Everything else, on request */}
              {result.candidates.length > 0 && (
                <div className="card">
                  <Collapsible label={`See all ${plural(result.candidates.length, 'option')}`} openLabel="Hide the full list">
                    <div style={{ overflowX: 'auto' }}>
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
                              <td>{fmtDate(c.expiry)}</td>
                              <td className="mono num">{c.dte}</td>
                              <td className="mono num" style={{ color: 'var(--text)', fontWeight: 600 }}>{money(c.strike)}</td>
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
