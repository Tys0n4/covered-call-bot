// src/pages/Dashboard.jsx
import { useEffect, useState, useMemo } from 'react'
import { getPortfolio, getAllPositions } from '../api/client'
import { Link } from 'react-router-dom'
import { ScanLine, LayoutGrid, ArrowUpRight } from 'lucide-react'
import { AreaChart, Area, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts'

function TickerCard({ ticker: t, positions }) {
  const grossPremium = positions.reduce((s, p) => s + p.premium_total, 0)

  return (
    <div className="card-gradient" style={{ marginBottom: 20 }}>
      {/* Ticker header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            fontFamily: 'JetBrains Mono, monospace', fontWeight: 700,
            fontSize: 22, color: 'var(--purple-light)',
            background: 'var(--purple-dim)', border: '1px solid var(--border)',
            borderRadius: 10, padding: '4px 12px',
          }}>{t.ticker}</div>
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            {t.shares.toLocaleString()} shares · avg ${t.avg_cost.toFixed(2)}
          </div>
        </div>
        <div style={{
          fontFamily: 'JetBrains Mono, monospace', fontWeight: 700,
          fontSize: 18, color: 'var(--green)',
        }}>${grossPremium.toFixed(2)} <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 400 }}>collected</span></div>
      </div>

      {/* Stat row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 20 }}>
        {[
          ['Total',     t.total_contracts,  'var(--text)'],
          ['Income',    `${t.open_income}/${t.target_income}`,   'var(--purple-light)'],
          ['Balanced',  `${t.open_balanced}/${t.target_balanced}`, 'var(--blue)'],
          ['Open',      t.open_total,       'var(--text)'],
          ['Available', t.available,        t.available > 0 ? 'var(--amber)' : 'var(--text-muted)'],
        ].map(([label, val, color]) => (
          <div key={label} style={{
            background: 'rgba(0,0,0,0.18)', borderRadius: 12,
            padding: '12px 14px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>{label}</div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, fontSize: 19, color }}>{val}</div>
          </div>
        ))}
      </div>

      {/* Allocation bar */}
      <div style={{ marginBottom: positions.length > 0 ? 20 : 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.03em' }}>ALLOCATION</span>
          <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--text-muted)' }}>
            <span><span style={{ color: 'var(--purple-light)' }}>■</span> Income {Math.round(t.open_income/t.total_contracts*100)||0}%</span>
            <span><span style={{ color: 'var(--blue)' }}>■</span> Balanced {Math.round(t.open_balanced/t.total_contracts*100)||0}%</span>
            <span><span style={{ color: 'var(--text-muted)', opacity: 0.6 }}>■</span> Available {Math.round(t.available/t.total_contracts*100)||0}%</span>
          </div>
        </div>
        <div style={{ height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 99, overflow: 'hidden', display: 'flex' }}>
          {t.open_income > 0 && (
            <div style={{ width: `${t.open_income/t.total_contracts*100}%`, background: 'linear-gradient(90deg, var(--purple), var(--purple-light))', transition: 'width 0.5s' }} />
          )}
          {t.open_balanced > 0 && (
            <div style={{ width: `${t.open_balanced/t.total_contracts*100}%`, background: 'linear-gradient(90deg, #2fb8d6, var(--blue))', transition: 'width 0.5s' }} />
          )}
        </div>
      </div>

      {/* Positions mini table */}
      {positions.length > 0 && (
        <table className="data-table" style={{ marginTop: 4 }}>
          <thead>
            <tr>
              <th>Type</th><th>Expiry</th><th className="num">Strike</th>
              <th className="num">Contracts</th><th className="num">Entry</th><th className="num">Premium</th><th>Opened</th>
            </tr>
          </thead>
          <tbody>
            {positions.map(p => (
              <tr key={p.id}>
                <td><span className={`badge badge-${p.allocation_type === 'Income' ? 'purple' : 'blue'}`}>{p.allocation_type}</span></td>
                <td className="mono">{p.expiry}</td>
                <td className="mono num" style={{ color: 'var(--text)', fontWeight: 600 }}>${p.strike.toFixed(2)}</td>
                <td className="mono num">{p.contracts}</td>
                <td className="mono num">${p.entry_price.toFixed(2)}</td>
                <td className="mono num" style={{ color: 'var(--green)' }}>${p.premium_total.toFixed(2)}</td>
                <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{p.opened_at}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {positions.length === 0 && (
        <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text-muted)', fontSize: 13 }}>
          No open positions for {t.ticker}.{' '}
          <Link to="/scanner" style={{ color: 'var(--purple-light)' }}>Run a scan →</Link>
        </div>
      )}
    </div>
  )
}

export default function Dashboard() {
  const [portfolio,    setPortfolio]    = useState([])
  const [positions,    setPositions]    = useState([])
  const [allPositions, setAllPositions] = useState([])
  const [loading,      setLoading]      = useState(true)

  useEffect(() => {
    Promise.all([getPortfolio(), getAllPositions()])
      .then(([portRes, posRes]) => {
        setPortfolio(portRes.data)
        setPositions(posRes.data.filter(p => p.status === 'OPEN'))
        setAllPositions(posRes.data)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const totalGross     = positions.reduce((s, p) => s + p.premium_total, 0)
  const totalOpen      = positions.length
  const totalContracts = portfolio.reduce((s, t) => s + t.total_contracts, 0)

  // Cumulative premium collected over time, for a quiet trend line under
  // the hero number — the "big number + sparkline" pattern most brokerage
  // dashboards lead with, built from real position history.
  const chartData = useMemo(() => {
    const sorted = [...allPositions].sort((a, b) => new Date(a.opened_at) - new Date(b.opened_at))
    let running = 0
    return sorted.map(p => {
      running += p.premium_total
      return { date: p.opened_at, total: Number(running.toFixed(2)) }
    })
  }, [allPositions])

  return (
    <div className="fade-up">
      {/* Header */}
      <div style={{ marginBottom: 32, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 4 }}>Dashboard</h1>
          <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>
            {new Date().toLocaleDateString('en-CA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </div>
        </div>
        <Link to="/scanner">
          <button className="btn-primary"><ScanLine size={16} strokeWidth={2} /> Run Scan</button>
        </Link>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}>
          <div className="spinner" style={{ width: 36, height: 36 }} />
        </div>
      ) : (
        <>
          {/* Summary row — hero premium metric with trend, plus supporting stats */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr 1fr 1fr', gap: 16, marginBottom: 28 }}>
            <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div className="stat-label">Gross Premium Collected</div>
                  <div className="stat-num" style={{ fontSize: 30 }}>${totalGross.toFixed(2)}</div>
                </div>
                {chartData.length >= 2 && (
                  <span className="badge badge-green">
                    <ArrowUpRight size={12} /> {chartData.length} fills
                  </span>
                )}
              </div>
              {chartData.length >= 2 ? (
                <div style={{ height: 52, marginTop: 12, marginLeft: -8, marginRight: -8 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                      <defs>
                        <linearGradient id="premiumFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#f2f2f5" stopOpacity={0.18} />
                          <stop offset="100%" stopColor="#f2f2f5" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="date" hide />
                      <YAxis hide domain={['dataMin', 'dataMax']} />
                      <Tooltip
                        contentStyle={{ background: '#17171e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, fontSize: 12 }}
                        labelStyle={{ color: '#9d9da9' }}
                        itemStyle={{ color: '#f2f2f5' }}
                        formatter={(v) => [`$${v.toFixed(2)}`, 'Collected']}
                      />
                      <Area type="monotone" dataKey="total" stroke="#d8d8e0" strokeWidth={1.75} fill="url(#premiumFill)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 'auto', paddingTop: 12 }}>
                  Trend appears once you have 2+ filled positions.
                </div>
              )}
            </div>
            {[
              ['Total Contracts', totalContracts,   'var(--text)'],
              ['Open Positions',  totalOpen,         'var(--purple-light)'],
              ['Tickers',         portfolio.length,  'var(--text)'],
            ].map(([label, val, color]) => (
              <div key={label} className="card">
                <div className="stat-label">{label}</div>
                <div className="stat-num" style={{ color }}>{val}</div>
              </div>
            ))}
          </div>

          {/* Per-ticker cards */}
          {portfolio.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>
              <LayoutGrid size={26} strokeWidth={1.75} style={{ opacity: 0.4, marginBottom: 10 }} />
              <div>No tickers in portfolio. Add rows to <code>data/portfolio.csv</code>.</div>
            </div>
          ) : (
            portfolio.map(t => (
              <TickerCard
                key={t.ticker}
                ticker={t}
                positions={positions.filter(p => p.ticker === t.ticker)}
              />
            ))
          )}
        </>
      )}
    </div>
  )
}
