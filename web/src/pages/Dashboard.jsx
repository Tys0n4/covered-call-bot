// src/pages/Dashboard.jsx
import { useEffect, useState, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { getPortfolio, getAllPositions, getAssignmentReview } from '../api/client'
import { useTicker } from '../context/TickerContext'
import { useToast } from '../context/ToastContext'
import { ScanLine, LayoutGrid, ArrowRight, CheckCircle2, Pencil, Plus, AlertTriangle } from 'lucide-react'
import { AreaChart, Area, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts'
import PageHeader from '../components/PageHeader'
import InfoTip from '../components/InfoTip'
import Collapsible from '../components/Collapsible'
import HoldingModal from '../components/dialogs/HoldingModal'
import ServerDown from '../components/ServerDown'
import { TERMS } from '../lib/terms'
import { fmtDate, money, plural } from '../lib/format'

function TickerCard({ ticker: t, positions, onScan, onPositions, onEdit }) {
  const collected = positions.reduce((s, p) => s + p.premium_total - (p.open_fees || 0), 0)
  const total = t.total_contracts || 0
  const w = n => (total > 0 ? `${(n / total) * 100}%` : '0%')

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18, gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span className="ticker-pill" style={{ fontSize: 18 }}>{t.ticker}</span>
          <span className="hint" style={{ fontSize: 14 }}>{t.shares.toLocaleString()} shares · avg cost {money(t.avg_cost)}</span>
          <button className="btn-secondary" onClick={onEdit} style={{ padding: '5px 12px', fontSize: 13, borderRadius: 9 }} aria-label={`Edit ${t.ticker}`}>
            <Pencil size={13} strokeWidth={2} /> Edit
          </button>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="stat-num" style={{ fontSize: 20, color: 'var(--green)' }}>{money(collected)}</div>
          <div className="hint">collected from open calls</div>
        </div>
      </div>

      {/* One-line status + bar */}
      <div style={{ fontSize: 16, marginBottom: 10 }}>
        <strong>{t.open_total} of {plural(total, 'contract')}</strong> working
        {t.available > 0 && <> · <strong style={{ color: 'var(--amber)' }}>{t.available} ready to sell</strong></>}
        <span style={{ marginLeft: 6 }}><InfoTip text={TERMS.available} /></span>
      </div>
      <div style={{ height: 8, background: 'rgba(255,255,255,0.06)', borderRadius: 99, overflow: 'hidden', display: 'flex', marginBottom: 10 }}>
        <div style={{ width: w(t.open_income), background: 'linear-gradient(90deg, var(--accent), var(--accent-light))', transition: 'width 0.5s' }} />
        <div style={{ width: w(t.open_balanced), background: 'linear-gradient(90deg, #3b8fd0, var(--blue))', transition: 'width 0.5s' }} />
      </div>
      <div style={{ display: 'flex', gap: 20, fontSize: 13, color: 'var(--text-muted)', marginBottom: 18, flexWrap: 'wrap' }}>
        {/* Hide a side your split doesn't use, unless calls of that kind are still open */}
        {(t.target_income > 0 || t.open_income > 0) && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: 99, background: 'var(--accent-light)' }} />
            {t.target_income > 0 ? <>Income: {t.open_income} of {t.target_income}</> : <>Income: {t.open_income} open (not in your split)</>}
            <InfoTip text={TERMS.income} size={12} />
          </span>
        )}
        {(t.target_balanced > 0 || t.open_balanced > 0) && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: 99, background: 'var(--blue)' }} />
            {t.target_balanced > 0 ? <>Balanced: {t.open_balanced} of {t.target_balanced}</> : <>Balanced: {t.open_balanced} open (not in your split)</>}
            <InfoTip text={TERMS.balanced} size={12} />
          </span>
        )}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: 99, background: 'rgba(255,255,255,0.18)' }} />
          Not sold: {t.available}
        </span>
      </div>

      {/* Next step */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', background: 'rgba(0,0,0,0.18)', borderRadius: 12, padding: '14px 16px', marginBottom: positions.length ? 14 : 0 }}>
        {t.available > 0 ? (
          <>
            <span style={{ fontSize: 14, color: 'var(--text-dim)' }}>
              <strong style={{ color: 'var(--text)' }}>Next step:</strong> find a call for your {plural(t.available, 'unused contract')}.
            </span>
            <button className="btn-primary" onClick={onScan} style={{ padding: '9px 18px' }}><ScanLine size={15} strokeWidth={2} /> Scan {t.ticker}</button>
          </>
        ) : (
          <>
            <span style={{ fontSize: 14, color: 'var(--text-dim)', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <CheckCircle2 size={16} color="var(--green)" /> All contracts are working. Check if any are ready to buy back.
            </span>
            <button className="btn-secondary" onClick={onPositions} style={{ padding: '9px 18px' }}>View positions <ArrowRight size={15} /></button>
          </>
        )}
      </div>

      {/* Details on request */}
      {positions.length > 0 && (
        <Collapsible label={`Show ${plural(positions.length, 'open call')}`} openLabel="Hide open calls">
          <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr><th>Type</th><th className="num">Strike</th><th>Expires</th><th className="num">Contracts</th><th className="num">Collected</th></tr>
            </thead>
            <tbody>
              {positions.map(p => (
                <tr key={p.id}>
                  <td><span className={`badge badge-${p.allocation_type === 'Income' ? 'accent' : 'blue'}`}>{p.allocation_type}</span></td>
                  <td className="mono num" style={{ color: 'var(--text)', fontWeight: 600 }}>{money(p.strike)}</td>
                  <td>{fmtDate(p.expiry)}</td>
                  <td className="mono num">{p.contracts}</td>
                  <td className="mono num" style={{ color: 'var(--green)' }}>{money(p.premium_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </Collapsible>
      )}
    </div>
  )
}

export default function Dashboard() {
  const navigate = useNavigate()
  const { selectTicker, applyPortfolio } = useTicker()
  const toast = useToast()
  const [editing,      setEditing]      = useState(null)   // null | 'new' | a holding row
  const [portfolio,    setPortfolio]    = useState([])
  const [positions,    setPositions]    = useState([])
  const [allPositions, setAllPositions] = useState([])
  const [loading,      setLoading]      = useState(true)
  const [loadFailed,   setLoadFailed]   = useState(false)
  const [reloadKey,    setReloadKey]    = useState(0)
  const [reviewCount,  setReviewCount]  = useState(0)   // expired calls that may have been assigned

  useEffect(() => {
    let cancelled = false
    Promise.all([getPortfolio(), getAllPositions()])
      .then(([portRes, posRes]) => {
        if (cancelled) return
        setPortfolio(portRes.data)
        setPositions(posRes.data.filter(p => p.status === 'OPEN'))
        setAllPositions(posRes.data)
        setLoadFailed(false)
        applyPortfolio(portRes.data)
      })
      .catch(() => { if (!cancelled) setLoadFailed(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    getAssignmentReview()
      .then(r => { if (!cancelled) setReviewCount(r.data.length) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [reloadKey, applyPortfolio])

  const retry = () => { setLoading(true); setReloadKey(k => k + 1) }

  // After opening fees, same as "Still open" on the Performance page
  const openPremium    = positions.reduce((s, p) => s + p.premium_total - (p.open_fees || 0), 0)
  const totalContracts = portfolio.reduce((s, t) => s + t.total_contracts, 0)
  const working        = portfolio.reduce((s, t) => s + t.open_total, 0)
  const available      = portfolio.reduce((s, t) => s + t.available, 0)

  // Running total of premium from every call you've sold, oldest first.
  const chartData = useMemo(() => {
    const sorted = [...allPositions].sort((a, b) => new Date(a.opened_at) - new Date(b.opened_at))
    return sorted.reduce((points, p) => {
      const prev = points.length ? points[points.length - 1].total : 0
      points.push({ date: p.opened_at, total: Number((prev + p.premium_total - (p.open_fees || 0)).toFixed(2)) })
      return points
    }, [])
  }, [allPositions])

  const go = (ticker, path) => { selectTicker(ticker); navigate(path) }

  // The API returns the updated portfolio after every add/edit/remove
  const handleSaved = (rows, ticker) => {
    setPortfolio(rows)
    applyPortfolio(rows)
    if (ticker && editing === 'new') selectTicker(ticker)
    toast(editing === 'new' ? `${ticker} added` : ticker ? `${ticker} updated` : `${editing.ticker} removed`)
    setEditing(null)
  }

  return (
    <div className="fade-up">
      {editing && (
        <HoldingModal
          holding={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}
      <PageHeader
        title="Dashboard"
        subtitle={`Where your covered calls stand today, ${new Date().toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' })}.`}
        actions={<button className="btn-primary" onClick={() => navigate('/scanner')}><ScanLine size={16} strokeWidth={2} /> Find a trade</button>}
      />

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}>
          <div className="spinner" style={{ width: 36, height: 36 }} />
        </div>
      ) : loadFailed ? (
        <ServerDown onRetry={retry} />
      ) : (
        <>
          {reviewCount > 0 && (
            <div className="callout callout-amber" style={{ marginBottom: 20, alignItems: 'center' }}>
              <AlertTriangle size={18} strokeWidth={1.75} style={{ flexShrink: 0 }} />
              <span style={{ flex: 1 }}>
                {reviewCount === 1 ? 'A call' : `${reviewCount} calls`} expired with the stock above the strike, so your shares may have been called away.
              </span>
              <Link to="/positions" className="link-btn" style={{ color: 'inherit' }}>Review <ArrowRight size={15} /></Link>
            </div>
          )}

          {/* Three numbers that matter */}
          <div className="grid-stats" style={{ marginBottom: 32 }}>
            <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
              <div className="stat-label">Premium from open calls <InfoTip text="Premium from calls that are still open, after the fees you paid to sell them. Same as &quot;Still open&quot; on the Performance page." size={12} /></div>
              <div className="stat-num" style={{ fontSize: 32, color: 'var(--green)' }}>{money(openPremium)}</div>
              {chartData.length >= 2 ? (
                <>
                  <div style={{ height: 56, marginTop: 10, marginLeft: -8, marginRight: -8 }}>
                    <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 300, height: 56 }}>
                      <AreaChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                        <defs>
                          <linearGradient id="premiumFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#6ae4ff" stopOpacity={0.22} />
                            <stop offset="100%" stopColor="#6ae4ff" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <XAxis dataKey="date" hide />
                        <YAxis hide domain={['dataMin', 'dataMax']} />
                        <Tooltip
                          contentStyle={{ background: '#202a3e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, fontSize: 12 }}
                          labelStyle={{ color: '#cdd0d6' }}
                          itemStyle={{ color: '#ffffff' }}
                          labelFormatter={fmtDate}
                          formatter={(v) => [money(v), 'Total collected']}
                        />
                        <Area type="monotone" dataKey="total" stroke="#6ae4ff" strokeWidth={1.75} fill="url(#premiumFill)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="hint">
                    {money(chartData[chartData.length - 1].total)} collected from {plural(chartData.length, 'call')} all time ·{' '}
                    <Link to="/performance" style={{ color: 'var(--accent-light)' }}>net results</Link>
                  </div>
                </>
              ) : (
                <div className="hint" style={{ marginTop: 'auto', paddingTop: 12 }}>A trend line appears once you've sold 2 or more calls.</div>
              )}
            </div>
            <div className="card">
              <div className="stat-label">Contracts working <InfoTip text="Contracts with an open call sold against them. Each contract covers 100 shares." size={12} /></div>
              <div className="stat-num" style={{ fontSize: 32 }}>{working}<span className="muted" style={{ fontSize: 20 }}> / {totalContracts}</span></div>
              <div className="hint" style={{ marginTop: 6 }}>across {plural(portfolio.length, 'stock')}</div>
            </div>
            <div className="card">
              <div className="stat-label">Ready to sell <InfoTip text={TERMS.available} size={12} /></div>
              <div className="stat-num" style={{ fontSize: 32, color: available > 0 ? 'var(--amber)' : 'var(--text)' }}>{available}</div>
              <div className="hint" style={{ marginTop: 6 }}>{available > 0 ? 'Scan to put these to work.' : 'Everything is covered.'}</div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div className="section-title" style={{ margin: 0 }}>Your stocks</div>
            {portfolio.length > 0 && (
              <button className="btn-secondary" onClick={() => setEditing('new')} style={{ padding: '8px 16px' }}>
                <Plus size={15} strokeWidth={2} /> Add stock
              </button>
            )}
          </div>
          {portfolio.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: 60 }}>
              <LayoutGrid size={28} strokeWidth={1.75} style={{ opacity: 0.4, marginBottom: 10 }} />
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>No stocks yet</div>
              <div className="hint" style={{ marginBottom: 18 }}>Add the shares you own to start finding covered calls.</div>
              <button className="btn-primary" onClick={() => setEditing('new')}><Plus size={16} strokeWidth={2} /> Add your first stock</button>
            </div>
          ) : (
            portfolio.map(t => (
              <TickerCard
                key={t.ticker}
                ticker={t}
                positions={positions.filter(p => p.ticker === t.ticker)}
                onScan={() => go(t.ticker, '/scanner')}
                onPositions={() => go(t.ticker, '/positions')}
                onEdit={() => setEditing(t)}
              />
            ))
          )}
        </>
      )}
    </div>
  )
}
