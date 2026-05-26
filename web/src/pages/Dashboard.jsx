// src/pages/Dashboard.jsx
import { useEffect, useState } from 'react'
import { getPortfolio, getAllPositions } from '../api/client'
import { Link } from 'react-router-dom'

function TickerCard({ ticker: t, positions }) {
  const incomePos   = positions.filter(p => p.allocation_type === 'Income')
  const balancedPos = positions.filter(p => p.allocation_type === 'Balanced')
  const grossPremium = positions.reduce((s, p) => s + p.premium_total, 0)

  return (
    <div className="card-gradient" style={{ marginBottom: 20 }}>
      {/* Ticker header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            fontFamily: 'JetBrains Mono, monospace', fontWeight: 800,
            fontSize: 22, color: 'var(--purple-light)',
            background: 'var(--purple-dim)', border: '1px solid var(--border)',
            borderRadius: 8, padding: '4px 12px',
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
          ['Balanced',  `${t.open_balanced}/${t.target_balanced}`, '#34d399'],
          ['Open',      t.open_total,       'var(--text)'],
          ['Available', t.available,        t.available > 0 ? 'var(--amber)' : 'var(--text-muted)'],
        ].map(([label, val, color]) => (
          <div key={label} style={{
            background: 'rgba(0,0,0,0.2)', borderRadius: 10,
            padding: '12px 14px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>{label}</div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 20, color }}>{val}</div>
          </div>
        ))}
      </div>

      {/* Allocation bar */}
      <div style={{ marginBottom: positions.length > 0 ? 20 : 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.04em' }}>ALLOCATION</span>
          <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--text-muted)' }}>
            <span><span style={{ color: 'var(--purple-light)' }}>■</span> Income {Math.round(t.open_income/t.total_contracts*100)||0}%</span>
            <span><span style={{ color: '#34d399' }}>■</span> Balanced {Math.round(t.open_balanced/t.total_contracts*100)||0}%</span>
            <span><span style={{ color: 'var(--text-muted)', opacity: 0.5 }}>■</span> Available {Math.round(t.available/t.total_contracts*100)||0}%</span>
          </div>
        </div>
        <div style={{ height: 8, background: 'rgba(139,92,246,0.1)', borderRadius: 99, overflow: 'hidden', display: 'flex' }}>
          {t.open_income > 0 && (
            <div style={{ width: `${t.open_income/t.total_contracts*100}%`, background: 'linear-gradient(90deg, #7c3aed, #8b5cf6)', transition: 'width 0.5s' }} />
          )}
          {t.open_balanced > 0 && (
            <div style={{ width: `${t.open_balanced/t.total_contracts*100}%`, background: 'linear-gradient(90deg, #10b981, #34d399)', transition: 'width 0.5s' }} />
          )}
        </div>
      </div>

      {/* Positions mini table */}
      {positions.length > 0 && (
        <table className="data-table" style={{ marginTop: 4 }}>
          <thead>
            <tr>
              <th>Type</th><th>Expiry</th><th>Strike</th>
              <th>Contracts</th><th>Entry</th><th>Premium</th><th>Opened</th>
            </tr>
          </thead>
          <tbody>
            {positions.map(p => (
              <tr key={p.id}>
                <td><span className={`badge badge-${p.allocation_type === 'Income' ? 'purple' : 'green'}`}>{p.allocation_type}</span></td>
                <td className="mono">{p.expiry}</td>
                <td className="mono" style={{ color: 'var(--text)', fontWeight: 600 }}>${p.strike.toFixed(2)}</td>
                <td className="mono">{p.contracts}</td>
                <td className="mono">${p.entry_price.toFixed(2)}</td>
                <td className="mono" style={{ color: 'var(--green)' }}>${p.premium_total.toFixed(2)}</td>
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
  const [portfolio,  setPortfolio]  = useState([])
  const [positions,  setPositions]  = useState([])
  const [loading,    setLoading]    = useState(true)

  useEffect(() => {
    Promise.all([getPortfolio(), getAllPositions()])
      .then(([portRes, posRes]) => {
        setPortfolio(portRes.data)
        setPositions(posRes.data.filter(p => p.status === 'OPEN'))
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const totalGross     = positions.reduce((s, p) => s + p.premium_total, 0)
  const totalOpen      = positions.length
  const totalContracts = portfolio.reduce((s, t) => s + t.total_contracts, 0)

  return (
    <div className="fade-up">
      {/* Header */}
      <div style={{ marginBottom: 32, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.03em', marginBottom: 4 }}>Dashboard</h1>
          <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>
            {new Date().toLocaleDateString('en-CA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </div>
        </div>
        <Link to="/scanner">
          <button className="btn-primary"><span>◎</span> Run Scan</button>
        </Link>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}>
          <div className="spinner" style={{ width: 36, height: 36 }} />
        </div>
      ) : (
        <>
          {/* Combined summary row */}
          <div style={{ display: 'flex', gap: 16, marginBottom: 28 }}>
            {[
              ['Total Contracts',  totalContracts,         'var(--text)'],
              ['Open Positions',   totalOpen,              'var(--purple-light)'],
              ['Gross Premium',    `$${totalGross.toFixed(2)}`, 'var(--green)'],
              ['Tickers',         portfolio.length,        'var(--text)'],
            ].map(([label, val, color]) => (
              <div key={label} className="card" style={{ flex: 1 }}>
                <div className="stat-label">{label}</div>
                <div className="stat-num" style={{ color }}>{val}</div>
              </div>
            ))}
          </div>

          {/* Per-ticker cards */}
          {portfolio.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>▦</div>
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
