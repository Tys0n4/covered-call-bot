// src/pages/Manage.jsx
import { useState } from 'react'
import { getManagement, closePosition } from '../api/client'
import { useTicker } from '../context/TickerContext'
import { RefreshCw, AlertTriangle, CheckCircle2, Clock3 } from 'lucide-react'

export default function Manage() {
  const { selected } = useTicker()
  const [result,  setResult]  = useState(null)
  const [loading, setLoading] = useState(false)
  const [closing, setClosing] = useState(null)
  const [error,   setError]   = useState(null)

  const handleEvaluate = async () => {
    setLoading(true); setError(null)
    try {
      const res = await getManagement(selected)
      setResult(res.data)
    } catch {
      setError('Could not evaluate positions. Is the API running?')
    } finally {
      setLoading(false)
    }
  }

  const handleClose = async (id) => {
    setClosing(id)
    await closePosition(id)
    setResult(r => ({ ...r, positions: r.positions.filter(p => p.id !== id) }))
    setClosing(null)
  }

  return (
    <div className="fade-up">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
            <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em' }}>Manage</h1>
            {selected && (
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 14, color: 'var(--purple-light)', background: 'var(--purple-dim)', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 10px' }}>{selected}</span>
            )}
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>Evaluate open positions and identify buyback opportunities.</p>
        </div>
        <button className="btn-primary" onClick={handleEvaluate} disabled={loading || !selected}>
          {loading ? <><span className="spinner" /> Evaluating...</> : <><RefreshCw size={15} strokeWidth={2} /> Evaluate {selected || 'Positions'}</>}
        </button>
      </div>

      {!selected && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--amber-dim)', border: '1px solid rgba(245,165,36,0.2)', borderRadius: 14, padding: 16, color: 'var(--amber)', fontSize: 14 }}>
          <AlertTriangle size={16} strokeWidth={1.75} /> Select a ticker from the sidebar to evaluate positions.
        </div>
      )}

      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--red-dim)', border: '1px solid rgba(240,71,95,0.25)', borderRadius: 14, padding: 16, marginBottom: 20, color: 'var(--red)', fontSize: 14 }}>
          <AlertTriangle size={16} strokeWidth={1.75} /> {error}
        </div>
      )}

      {result && (
        <>
          <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
            {[
              ['Evaluated',           result.positions_evaluated, 'var(--text)'],
              ['Buyback Recommended', result.buyback_recommended, result.buyback_recommended > 0 ? 'var(--green)' : 'var(--text)'],
              ['Holding',             result.positions_evaluated - result.buyback_recommended, 'var(--text-dim)'],
            ].map(([label, val, color]) => (
              <div key={label} className="card" style={{ flex: 1 }}>
                <div className="stat-label">{label}</div>
                <div className="stat-num" style={{ color }}>{val}</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {result.positions.map(p => {
              const pct = Math.min(p.profit_capture_pct, 100)
              const buyback = p.should_buy_back
              return (
                <div key={p.id} className="card" style={{ borderColor: buyback ? 'rgba(47,208,119,0.3)' : 'var(--border)', background: buyback ? 'linear-gradient(135deg, var(--bg-card) 0%, rgba(47,208,119,0.04) 100%)' : 'var(--bg-card)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 18, color: 'var(--text)' }}>{p.ticker}</span>
                      <span className={`badge badge-${p.allocation_type === 'Income' ? 'purple' : 'blue'}`}>{p.allocation_type}</span>
                      {buyback
                        ? <span className="badge badge-green"><CheckCircle2 size={12} strokeWidth={2} /> BUY BACK</span>
                        : <span className="badge badge-amber"><Clock3 size={12} strokeWidth={2} /> HOLD</span>}
                    </div>
                    {buyback && (
                      <button className="btn-danger" onClick={() => handleClose(p.id)} disabled={closing === p.id}>
                        {closing === p.id ? <span className="spinner" style={{ width: 14, height: 14 }} /> : 'Mark Closed'}
                      </button>
                    )}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12, marginBottom: 16 }}>
                    {[
                      ['Expiry', p.expiry], ['Strike', `$${p.strike.toFixed(2)}`], ['Contracts', p.contracts],
                      ['Entry', `$${p.entry_price.toFixed(2)}`],
                      ['Current Ask', p.current_option_price > 0 ? `$${p.current_option_price.toFixed(2)}` : 'n/a'],
                      ['Cost to Close', p.cost_to_close > 0 ? `$${p.cost_to_close.toFixed(2)}` : '$0.00'],
                    ].map(([k, v]) => (
                      <div key={k}>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{k}</div>
                        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>{v}</div>
                      </div>
                    ))}
                  </div>

                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>Profit Captured</span>
                      <span style={{ fontSize: 12, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: buyback ? 'var(--green)' : pct > 50 ? 'var(--purple-light)' : 'var(--text-dim)' }}>{p.profit_capture_pct.toFixed(1)}%</span>
                    </div>
                    <div className="progress-bar">
                      <div className="progress-fill" style={{ width: `${pct}%`, background: buyback ? 'linear-gradient(90deg, #22b06a, #2fd077)' : 'linear-gradient(90deg, #6a5cf0, #a99bff)' }} />
                    </div>
                    {p.current_option_price === 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--amber)', marginTop: 6 }}>
                        <AlertTriangle size={12} strokeWidth={1.75} /> Could not fetch current price — verify on broker
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {result.positions.length === 0 && (
            <div className="card" style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>No open positions to evaluate for {selected}.</div>
          )}
        </>
      )}

      {!result && !loading && selected && (
        <div className="card" style={{ textAlign: 'center', padding: 80, color: 'var(--text-muted)' }}>
          <RefreshCw size={38} strokeWidth={1.5} style={{ marginBottom: 16, opacity: 0.3 }} />
          <div style={{ fontSize: 15, fontWeight: 600 }}>Click "Evaluate {selected}" to check buyback conditions</div>
          <div style={{ fontSize: 13, marginTop: 6 }}>Fetches current ask prices for all open {selected} positions</div>
        </div>
      )}
    </div>
  )
}
