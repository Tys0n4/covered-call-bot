// src/pages/Dashboard.jsx
import { useEffect, useState, useMemo } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { getPortfolio, getAllPositions, getAssignmentReview, getManagement, getPerformance, getStrategy } from '../api/client'
import { useTicker } from '../context/TickerContext'
import { useToast } from '../context/ToastContext'
import { ScanLine, ArrowRight, CheckCircle2, Pencil, Plus, AlertTriangle, Layers, CalendarClock, Target, BadgeDollarSign } from 'lucide-react'
import { AreaChart, Area, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts'
import PageHeader from '../components/PageHeader'
import InfoTip from '../components/InfoTip'
import ActionMenu from '../components/ActionMenu'
import PriceStamp from '../components/PriceStamp'
import HoldingModal from '../components/dialogs/HoldingModal'
import ServerDown from '../components/ServerDown'
import { DashboardSkeleton } from '../components/Skeleton'
import { TERMS } from '../lib/terms'
import { daysUntil, fmtDate, money, plural } from '../lib/format'

// First visit: what the app does, in three steps, and the one thing to do now
function GettingStarted({ onAdd }) {
  const steps = [
    ['Add your stocks', 'Enter the shares you own and what you paid. Every 100 shares lets you sell one covered call.'],
    ['Scan for a call', 'The Scanner finds calls at least 15% above today’s price and recommends what to sell.'],
    ['Track and buy back', 'Positions checks prices and tells you when to buy back, roll, or let a call expire.'],
  ]
  return (
    <div className="card" style={{ padding: 32 }}>
      <div className="section-title" style={{ fontSize: 20, marginBottom: 6 }}>Welcome to CovCall</div>
      <div className="hint" style={{ fontSize: 14, marginBottom: 24 }}>Earn income from shares you already own by selling covered calls. Here’s how it works:</div>
      <div className="grid-steps" style={{ marginBottom: 28 }}>
        {steps.map(([t, d], i) => (
          <div key={t} style={{ display: 'flex', gap: 12 }}>
            <div className={`step-num${i === 0 ? ' current' : ''}`}>{i + 1}</div>
            <div>
              <div style={{ fontWeight: 700, marginBottom: 2 }}>{t}</div>
              <div className="hint">{d}</div>
            </div>
          </div>
        ))}
      </div>
      <button className="btn-primary" onClick={onAdd}><Plus size={16} strokeWidth={2} /> Add your first stock</button>
    </div>
  )
}

// One line in the "Needs attention" box
function Attention({ icon: Icon, tone, children, action }) {
  return (
    <div className="attention-row">
      <span className={`attention-icon tone-${tone}`}><Icon size={16} strokeWidth={2} /></span>
      <div className="attention-body">{children}</div>
      {action}
    </div>
  )
}

// Compact row per stock: shares, how many contracts are working, and the next step
function StockRow({ ticker: t, positions, onScan, onPositions, onEdit }) {
  const collected = positions.reduce((s, p) => s + p.premium_total - (p.open_fees || 0), 0)
  const total = t.total_contracts || 0
  const w = n => (total > 0 ? `${(n / total) * 100}%` : '0%')
  return (
    <div className="stock-row">
      <div className="stock-name">
        <span className="ticker-pill">{t.ticker}</span>
        <span className="hint">{t.shares.toLocaleString()} shares · avg {money(t.avg_cost)}</span>
      </div>
      <div className="stock-bar">
        <div style={{ fontSize: 13.5, marginBottom: 6 }}>
          <strong>{t.open_total}</strong><span className="muted"> of {plural(total, 'contract')} working</span>
        </div>
        <div className="split-bar" title={`Income ${t.open_income}, Balanced ${t.open_balanced}, not sold ${t.available}`}>
          <div style={{ width: w(t.open_income), background: 'linear-gradient(90deg, var(--accent), var(--accent-light))' }} />
          <div style={{ width: w(t.open_balanced), background: 'linear-gradient(90deg, #3b8fd0, var(--blue))' }} />
        </div>
      </div>
      <div className="stock-num">
        <div className="mono" style={{ color: collected > 0 ? 'var(--green)' : 'var(--text-muted)', fontWeight: 600 }}>{money(collected)}</div>
        <div className="hint">open premium</div>
      </div>
      <div className="stock-actions">
        {t.available > 0
          ? <button className="btn-primary" onClick={onScan} style={{ padding: '7px 14px', fontSize: 13 }}><ScanLine size={14} strokeWidth={2} /> Sell {t.available}</button>
          : <span className="badge badge-green"><CheckCircle2 size={13} strokeWidth={2} /> Covered</span>}
        <ActionMenu label={`Actions for ${t.ticker}`} items={[
          { label: 'View positions', icon: Layers, onClick: onPositions },
          { label: 'Scan for a call', icon: ScanLine, onClick: onScan },
          { label: 'Edit shares or cost', icon: Pencil, onClick: onEdit },
        ]} />
      </div>
    </div>
  )
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { selectTicker, applyPortfolio } = useTicker()
  const toast = useToast()
  // null | 'new' | a holding row; /?add=1 (from Scanner or Positions) opens 'Add a stock'
  const [editing,      setEditing]      = useState(() => (params.get('add') === '1' ? 'new' : null))
  const [portfolio,    setPortfolio]    = useState([])
  const [positions,    setPositions]    = useState([])
  const [allPositions, setAllPositions] = useState([])
  const [loading,      setLoading]      = useState(true)
  const [loadFailed,   setLoadFailed]   = useState(false)
  const [reloadKey,    setReloadKey]    = useState(0)
  const [reviewCount,  setReviewCount]  = useState(0)   // expired calls that may have been assigned
  const [readyIds,     setReadyIds]     = useState(null) // ids of calls ready to buy back (null = not checked yet)
  const [priceMeta,    setPriceMeta]    = useState(null) // when those prices were checked
  const [goal,         setGoal]         = useState(null) // { target, kept, month } when a monthly goal is set

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
    // Live option prices are slower, so they fill in after the page shows
    getManagement()
      .then(r => { if (!cancelled) { setReadyIds(new Set(r.data.positions.filter(e => e.should_buy_back).map(e => e.id))); setPriceMeta(r.data) } })
      .catch(() => {})
    Promise.all([getStrategy(), getPerformance()])
      .then(([st, perf]) => {
        if (cancelled || !(st.data.monthly_goal > 0)) return
        setGoal({ target: st.data.monthly_goal, kept: perf.data.summary.realized_this_month, month: perf.data.summary.month })
      })
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

  // What needs doing: buybacks, calls expiring within a week, unsold contracts, the monthly goal
  const ready     = readyIds ? positions.filter(p => readyIds.has(p.id)) : []
  const expiring  = positions.filter(p => { const d = daysUntil(p.expiry); return d != null && d >= 0 && d <= 7 })
                      .sort((a, b) => a.expiry.localeCompare(b.expiry))
  const unsold    = portfolio.filter(t => t.available > 0)
  const goalPct   = goal ? Math.max(0, Math.round((goal.kept / goal.target) * 100)) : 0
  const goalMonth = goal ? new Date(Number(goal.month.slice(0, 4)), Number(goal.month.slice(5, 7)) - 1, 1).toLocaleDateString('en-CA', { month: 'long' }) : ''
  const callList  = list => list.slice(0, 3).map(p => `${p.ticker} ${money(p.strike, 0)}`).join(', ') + (list.length > 3 ? ` and ${list.length - 3} more` : '')
  const allClear  = reviewCount === 0 && ready.length === 0 && expiring.length === 0 && unsold.length === 0

  const closeEditor = () => {
    setEditing(null)
    if (params.has('add')) setParams({}, { replace: true })
  }

  // The API returns the updated portfolio after every add/edit/remove
  const handleSaved = (rows, ticker) => {
    setPortfolio(rows)
    applyPortfolio(rows)
    if (ticker && editing === 'new') selectTicker(ticker)
    toast(editing === 'new' ? `${ticker} added` : ticker ? `${ticker} updated` : `${editing.ticker} removed`)
    closeEditor()
  }

  return (
    <div className="fade-up">
      {editing && (
        <HoldingModal
          holding={editing === 'new' ? null : editing}
          onClose={closeEditor}
          onSaved={handleSaved}
        />
      )}
      <PageHeader
        title="Dashboard"
        subtitle={`Where your covered calls stand today, ${new Date().toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' })}.`}
        actions={!loading && !loadFailed && portfolio.length > 0 &&
          <button className="btn-primary" onClick={() => navigate('/scanner')}><ScanLine size={16} strokeWidth={2} /> Find a trade</button>}
      />

      {loading ? (
        <DashboardSkeleton />
      ) : loadFailed ? (
        <ServerDown onRetry={retry} />
      ) : portfolio.length === 0 ? (
        <GettingStarted onAdd={() => setEditing('new')} />
      ) : (
        <>
          {portfolio.length > 0 && (
            <div className="card attention" style={{ marginBottom: 20 }}>
              <div className="section-title" style={{ marginBottom: 6 }}>Needs attention</div>
              {reviewCount > 0 && (
                <Attention icon={AlertTriangle} tone="amber"
                  action={<Link to="/positions" className="link-btn">Review <ArrowRight size={14} /></Link>}>
                  {reviewCount === 1 ? 'A call' : `${reviewCount} calls`} expired with the stock above the strike. Were your shares called away?
                </Attention>
              )}
              {ready.length > 0 && (
                <Attention icon={BadgeDollarSign} tone="green"
                  action={<Link to="/positions" className="link-btn">Buy back <ArrowRight size={14} /></Link>}>
                  <strong>{plural(ready.length, 'call')}</strong> {ready.length === 1 ? 'is' : 'are'} ready to buy back: <span className="muted">{callList(ready)}</span>
                </Attention>
              )}
              {expiring.length > 0 && (
                <Attention icon={CalendarClock} tone="blue"
                  action={<Link to="/positions" className="link-btn">View <ArrowRight size={14} /></Link>}>
                  <strong>{plural(expiring.length, 'call')}</strong> {expiring.length === 1 ? 'expires' : 'expire'} within a week: <span className="muted">{expiring.slice(0, 3).map(p => `${p.ticker} ${money(p.strike, 0)} on ${fmtDate(p.expiry)}`).join(', ')}{expiring.length > 3 ? ` and ${expiring.length - 3} more` : ''}</span>
                </Attention>
              )}
              {unsold.map(t => (
                <Attention key={t.ticker} icon={ScanLine} tone="accent"
                  action={<button className="link-btn" onClick={() => go(t.ticker, '/scanner')}>Scan {t.ticker} <ArrowRight size={14} /></button>}>
                  <strong>{plural(t.available, `${t.ticker} contract`)}</strong> ready to sell
                </Attention>
              ))}
              {goal && (
                <Attention icon={Target} tone={goalPct >= 100 ? 'green' : 'accent'}
                  action={<Link to="/performance" className="link-btn">Results <ArrowRight size={14} /></Link>}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
                    <span>Kept in {goalMonth}: <strong style={{ color: goal.kept < 0 ? 'var(--red)' : 'var(--text)' }}>{money(goal.kept)}</strong> <span className="muted">of {money(goal.target, 0)} goal</span></span>
                    <span className="mono nowrap" style={{ color: goalPct >= 100 ? 'var(--green)' : 'var(--text-dim)' }}>{goalPct >= 100 ? 'Goal reached' : `${goalPct}%`}</span>
                  </div>
                  <div className="progress-bar" style={{ maxWidth: 420 }}>
                    <div className="progress-fill" style={{ width: `${Math.min(goalPct, 100)}%`, background: goalPct >= 100 ? 'linear-gradient(90deg, #1fc99a, #34edb3)' : undefined }} />
                  </div>
                </Attention>
              )}
              {allClear && (
                <Attention icon={CheckCircle2} tone="green">
                  Nothing to do right now. Every contract is working{readyIds ? ' and no call is ready to buy back' : ''}.
                </Attention>
              )}
              {readyIds === null && positions.length > 0 && (
                <div className="hint" style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 10 }}>
                  <span className="spinner" style={{ width: 12, height: 12 }} /> Checking which calls are ready to buy back…
                </div>
              )}
              {readyIds && positions.length > 0 && <PriceStamp meta={priceMeta} style={{ paddingTop: 10 }} />}
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
            <button className="btn-secondary" onClick={() => setEditing('new')} style={{ padding: '8px 16px' }}>
              <Plus size={15} strokeWidth={2} /> Add stock
            </button>
          </div>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {portfolio.map(t => (
              <StockRow
                key={t.ticker}
                ticker={t}
                positions={positions.filter(p => p.ticker === t.ticker)}
                onScan={() => go(t.ticker, '/scanner')}
                onPositions={() => go(t.ticker, '/positions')}
                onEdit={() => setEditing(t)}
              />
            ))}
            <div className="split-legend">
              <span><i style={{ background: 'var(--accent-light)' }} /> Income <InfoTip text={TERMS.income} size={12} /></span>
              <span><i style={{ background: 'var(--blue)' }} /> Balanced <InfoTip text={TERMS.balanced} size={12} /></span>
              <span><i style={{ background: 'rgba(255,255,255,0.18)' }} /> Not sold</span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
