// src/pages/Scanner.jsx
import { useState, useEffect } from 'react'
import { runScan, savePositions } from '../api/client'
import { useTicker } from '../context/TickerContext'

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

function Field({ label, name, value, onChange, step = 1, min, max }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label className="label">{label}</label>
      <input
        type="number" className="input" step={step}
        min={min} max={max} value={value}
        onChange={e => onChange(name, parseFloat(e.target.value))}
      />
    </div>
  )
}

function PickCard({ label, pick, accent }) {
  if (!pick) return null
  return (
    <div style={{ background: 'var(--bg-card-2)', border: `1px solid ${accent}33`, borderRadius: 12, padding: 16, flex: 1 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: accent, letterSpacing: '0.08em', marginBottom: 12 }}>{label}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {[
          ['Expiry',    pick.expiry],
          ['Strike',    `$${pick.strike.toFixed(2)}`],
          ['Premium',   `$${pick.premium_price.toFixed(2)}`],
          ['Delta',     pick.delta?.toFixed(3) ?? 'n/a'],
          ['Ann.Yield', `${pick.annualized_yield_pct?.toFixed(1)}%`],
          ['Upside',    `${pick.upside_to_strike_pct?.toFixed(1)}%`],
        ].map(([k, v]) => (
          <div key={k}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{k}</div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, fontSize: 14, color: 'var(--text)', marginTop: 2 }}>{v}</div>
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

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  }, [config])

  // Reset result when ticker changes
  useEffect(() => {
    setResult(null); setError(null); setSaved(false)
  }, [selected])

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
    await savePositions(payload)
    setSaved(true)
  }

  return (
    <div className="fade-up">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.03em' }}>Scanner</h1>
        {selected && (
          <span style={{
            fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 14,
            color: 'var(--purple-light)', background: 'var(--purple-dim)',
            border: '1px solid var(--border)', borderRadius: 6, padding: '3px 10px',
          }}>{selected}</span>
        )}
      </div>
      <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 32 }}>
        Configure parameters and scan for covered call candidates.
      </p>

      {!selected && (
        <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 12, padding: 16, color: 'var(--amber)', fontSize: 14 }}>
          ⚠ Select a ticker from the sidebar to start scanning.
        </div>
      )}

      {selected && (
        <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 24, alignItems: 'start' }}>
          {/* Config panel */}
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--purple-light)' }}>◌ Scan Parameters</div>
              <button onClick={() => setConfig(DEFAULT_CONFIG)} style={{
                background: 'none', border: 'none', color: 'var(--text-muted)',
                fontSize: 11, cursor: 'pointer', fontFamily: 'Syne, sans-serif', padding: 0,
              }}>↺ Reset</button>
            </div>
            <Field label="Min DTE"           name="min_dte"            value={config.min_dte}           onChange={updateConfig} min={1}    max={60} />
            <Field label="Max DTE"           name="max_dte"            value={config.max_dte}           onChange={updateConfig} min={1}    max={120} />
            <Field label="Min Strike % OTM"  name="min_strike_pct"     value={config.min_strike_pct}    onChange={updateConfig} step={0.01} min={0.05} max={0.5} />
            <Field label="Min Premium ($)"   name="min_premium"        value={config.min_premium}       onChange={updateConfig} step={0.01} min={0.01} />
            <Field label="Min Volume"        name="min_volume"         value={config.min_volume}        onChange={updateConfig} min={1} />
            <Field label="Min Open Interest" name="min_open_interest"  value={config.min_open_interest} onChange={updateConfig} min={1} />
            <Field label="Target Delta"      name="target_delta"       value={config.target_delta}      onChange={updateConfig} step={0.01} min={0.05} max={0.5} />
            <button className="btn-primary" onClick={handleScan} disabled={loading} style={{ width: '100%', justifyContent: 'center', marginTop: 4 }}>
              {loading ? <><span className="spinner" /> Scanning {selected}...</> : <><span>◎</span> Scan {selected}</>}
            </button>
          </div>

          {/* Results */}
          <div>
            {error && (
              <div style={{ background: 'var(--red-dim)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 12, padding: 16, marginBottom: 20, color: 'var(--red)', fontSize: 14 }}>
                ⚠ {error}
              </div>
            )}

            {loading && (
              <div className="card" style={{ textAlign: 'center', padding: 60 }}>
                <div className="spinner" style={{ width: 40, height: 40, margin: '0 auto 16px' }} />
                <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>Fetching {selected} options chain...</div>
                <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 6 }}>This may take 15–30 seconds</div>
              </div>
            )}

            {result && !loading && (
              <>
                <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
                  {[
                    ['Current Price', `$${result.current_price.toFixed(2)}`],
                    ['Min Strike',    `$${result.min_strike.toFixed(2)}`],
                    ['Candidates',    result.candidates.length],
                    ['Gross Premium', `$${result.gross_premium.toFixed(2)}`],
                    ['Net Premium',   `$${result.net_premium.toFixed(2)}`],
                  ].map(([label, val]) => (
                    <div key={label} className="card-sm" style={{ flex: 1, textAlign: 'center' }}>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>{label}</div>
                      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, fontSize: 18, color: 'var(--text)' }}>{val}</div>
                    </div>
                  ))}
                </div>

                {result.warnings?.length > 0 && (
                  <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 10, padding: '12px 16px', marginBottom: 20 }}>
                    {result.warnings.map((w, i) => <div key={i} style={{ fontSize: 13, color: 'var(--amber)' }}>⚠ {w}</div>)}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
                  <PickCard label="⬆ INCOME PICK"   pick={result.income_pick}   accent="#8b5cf6" />
                  <PickCard label="⬡ BALANCED PICK" pick={result.balanced_pick} accent="#10b981" />
                </div>

                <div className="card" style={{ marginBottom: 20 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 16 }}>Candidates</div>
                  <div style={{ overflowX: 'auto' }}>
                    <table className="data-table">
                      <thead>
                        <tr><th>Expiry</th><th>DTE</th><th>Strike</th><th>Premium</th><th>Ann.Yield%</th><th>Delta</th><th>Upside%</th><th>Spread%</th><th>Quote</th></tr>
                      </thead>
                      <tbody>
                        {result.candidates.map((c, i) => (
                          <tr key={i}>
                            <td className="mono">{c.expiry}</td>
                            <td className="mono">{c.dte}</td>
                            <td className="mono" style={{ color: 'var(--text)', fontWeight: 600 }}>${c.strike.toFixed(2)}</td>
                            <td className="mono" style={{ color: 'var(--purple-light)' }}>${c.premium_price.toFixed(2)}</td>
                            <td className="mono">{c.annualized_yield_pct?.toFixed(1)}%</td>
                            <td className="mono">{c.delta?.toFixed(3) ?? 'n/a'}</td>
                            <td className="mono">{c.upside_to_strike_pct?.toFixed(1)}%</td>
                            <td className="mono">{c.spread_pct?.toFixed(1)}%</td>
                            <td><span className={`badge badge-${c.quote_quality === 'LIVE' ? 'green' : c.quote_quality === 'STALE' ? 'amber' : 'red'}`}>{c.quote_quality}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {result.planned_positions?.length > 0 && (
                  <div className="card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>Allocation Plan</div>
                      <div style={{ fontSize: 13, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-muted)' }}>
                        {result.allocation_summary?.available || 0} contracts available
                      </div>
                    </div>
                    <table className="data-table" style={{ marginBottom: 16 }}>
                      <thead>
                        <tr><th>Type</th><th>Expiry</th><th>Strike</th><th>Contracts</th><th>Entry</th><th>Gross</th><th>Buyback Budget</th></tr>
                      </thead>
                      <tbody>
                        {result.planned_positions.map((p, i) => (
                          <tr key={i}>
                            <td><span className={`badge badge-${p.allocation_type === 'Income' ? 'purple' : 'green'}`}>{p.allocation_type}</span></td>
                            <td className="mono">{p.expiry}</td>
                            <td className="mono" style={{ color: 'var(--text)', fontWeight: 600 }}>${p.strike.toFixed(2)}</td>
                            <td className="mono">{p.contracts}</td>
                            <td className="mono">${p.entry_price.toFixed(2)}</td>
                            <td className="mono" style={{ color: 'var(--green)' }}>${p.premium_total.toFixed(2)}</td>
                            <td className="mono">${p.buyback_total.toFixed(0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      {saved
                        ? <span style={{ color: 'var(--green)', fontSize: 13, fontWeight: 600 }}>✓ Positions saved</span>
                        : <button className="btn-primary" onClick={handleSave}>Save Positions</button>
                      }
                    </div>
                  </div>
                )}

                {result.candidates.length === 0 && (
                  <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                    <div style={{ fontSize: 20, marginBottom: 12 }}>📉</div>
                    <div style={{ fontWeight: 600, marginBottom: 8 }}>No candidates found</div>
                    <div style={{ fontSize: 13, lineHeight: 1.7 }}>
                      Options data is live during market hours <span style={{ color: 'var(--purple-light)' }}>(9:30am – 4:00pm ET, Mon – Fri)</span>.<br />
                      Outside market hours, bid/ask quotes go stale and candidates are filtered out.<br />
                      Try again during trading hours, or loosen the filters above.
                    </div>
                  </div>
                )}
              </>
            )}

            {!result && !loading && !error && (
              <div className="card" style={{ textAlign: 'center', padding: 80, color: 'var(--text-muted)' }}>
                <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }}>◎</div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>Configure and run a scan</div>
                <div style={{ fontSize: 13, marginTop: 6 }}>Results will appear here</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
