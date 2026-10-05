// src/pages/Dashboard.jsx
import { useEffect, useState, useMemo } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { getPortfolio, getAllPositions, getAssignmentReview, getManagement, getPerformance, getStrategy, getUpcoming } from '../api/client'
import { useTicker } from '../context/TickerContext'
import { useToast } from '../context/ToastContext'
import { ScanLine, ArrowRight, ArrowUpRight, CheckCircle2, Pencil, Plus, AlertTriangle, Layers, CalendarClock, BadgeDollarSign, Landmark, Megaphone, Clock3, ChevronDown } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import InfoTip from '../components/InfoTip'
import ActionMenu from '../components/ActionMenu'
import PriceStamp from '../components/PriceStamp'
import HoldingModal from '../components/dialogs/HoldingModal'
import ServerDown from '../components/ServerDown'
import { DashboardSkeleton } from '../components/Skeleton'
import { TERMS } from '../lib/terms'
import { daysUntil, fmtDate, money, plural } from '../lib/format'
import { againstYou } from '../lib/pnl'

// First visit: what the app does, in three steps, and the one thing to do now
function GettingStarted({ onAdd }) {
  const steps = [
    ['Add your stocks', 'Enter the shares you own and what you paid. Every 100 shares lets you sell one covered call.'],
    ['Scan for a call', 'The Scanner finds calls that fit your strategy and recommends what to sell.'],
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

// Premium in open calls and contracts working, under the goal
function OpenNumbers({ openPremium, working, totalContracts }) {
  return (
    <div className="goal-numbers">
      <div>
        <div className="stat-label">Premium in open calls <InfoTip text="Premium from calls that are still open, after the fees you paid to sell them. Same as &quot;Still open&quot; on the Performance page." size={12} /></div>
        <div className="mono goal-number" style={{ color: 'var(--green)' }}>{money(openPremium)}</div>
      </div>
      <div>
        <div className="stat-label">Contracts working <InfoTip text="Contracts with an open call sold against them. Each contract covers 100 shares." size={12} /></div>
        <div className="mono goal-number">{working}<span className="muted" style={{ fontSize: 15 }}> / {totalContracts}</span></div>
      </div>
    </div>
  )
}

// Monthly goal as a ring: how much you've kept this month, and how much is left to go
function GoalCard({ goal, numbers }) {
  if (!goal) {
    return (
      <section className="card goal-card" aria-label="Monthly goal">
        <div className="goal-text">
          <div className="section-title">Set a monthly goal</div>
          <div className="hint" style={{ fontSize: 14 }}>Optional. Shows your progress here and paces the Scanner's picks.</div>
          <Link to="/strategy" className="link-btn">Set a goal <ArrowRight size={14} /></Link>
        </div>
        {numbers}
      </section>
    )
  }
  const pct = Math.max(0, Math.round((goal.kept / goal.target) * 100))
  const r = 52, circ = 2 * Math.PI * r
  const now = new Date()
  const daysLeft = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate()
  const month = new Date(Number(goal.month.slice(0, 4)), Number(goal.month.slice(5, 7)) - 1, 1).toLocaleDateString('en-CA', { month: 'long' })
  const reached = pct >= 100
  return (
    <section className="card goal-card" aria-label="Monthly goal">
      <div className="goal-ring" role="img" aria-label={`${pct}% of your monthly goal`}>
        <svg width="124" height="124" viewBox="0 0 124 124" aria-hidden="true">
          <circle cx="62" cy="62" r={r} fill="none" stroke="var(--track)" strokeWidth="12" />
          <circle cx="62" cy="62" r={r} fill="none" stroke="var(--green)" strokeWidth="12" strokeLinecap="round"
            strokeDasharray={`${(Math.min(pct, 100) / 100) * circ} ${circ}`} transform="rotate(-90 62 62)" />
        </svg>
        <div className="goal-ring-label"><span className="mono">{pct}%</span><span>of goal</span></div>
      </div>
      <div className="goal-text">
        <div className="hint" style={{ fontSize: 14 }}>Kept in {month}</div>
        <div className="mono goal-amount" style={{ color: goal.kept < 0 ? 'var(--red)' : 'var(--green)' }}>{money(goal.kept)}</div>
        <div style={{ color: 'var(--text-dim)', fontSize: 14.5 }}>
          {reached
            ? <>Goal of {money(goal.target, 0)} reached for {month}.</>
            : <>of your {money(goal.target, 0)} goal · {money(goal.target - goal.kept, 0)} to go, {plural(daysLeft, 'day')} left</>}
        </div>
        <Link to="/performance" className="link-btn">See results <ArrowRight size={14} /></Link>
      </div>
      {numbers}
    </section>
  )
}

// The one thing to do first
function NextStep({ item, footer }) {
  return (
    <section className="card next-step" aria-label="Next step">
      <div>
        <div className="eyebrow">Next step</div>
        {item ? (
          <>
            <div className="next-title">{item.title}</div>
            <div style={{ color: 'var(--text-dim)', fontSize: 14.5, lineHeight: 1.5 }}>{item.body}</div>
          </>
        ) : (
          <>
            <div className="next-title"><CheckCircle2 size={22} strokeWidth={2} style={{ color: 'var(--green)', verticalAlign: '-3px', marginRight: 8 }} />All caught up</div>
            <div style={{ color: 'var(--text-dim)', fontSize: 14.5 }}>Every contract is working and nothing needs you right now.</div>
          </>
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
        {item?.cta && <button className="btn-primary" onClick={item.cta.onClick}>{item.cta.label} <ArrowRight size={15} strokeWidth={2} /></button>}
        {footer}
      </div>
    </section>
  )
}

// "Coming up": expiries, Fed decisions and earnings over the next 30 days.
// Three are shown, earnings and Fed decisions first (expiries are also on
// Positions), in date order; the rest open with "Show more".
const SHOWN = 3
const dayParts = iso => {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return { month: dt.toLocaleDateString('en-US', { month: 'short' }).toUpperCase(), day: d, weekday: dt.toLocaleDateString('en-US', { weekday: 'long' }) }
}

function ComingUp({ items, note, warning }) {
  const [open, setOpen] = useState(false)
  if (!items.length && !warning) return null
  const picked = new Set([...items.filter(i => i.event), ...items.filter(i => !i.event)].slice(0, SHOWN).map(i => i.key))
  const shown = open ? items : items.filter(i => picked.has(i.key))
  const more = items.length - SHOWN
  return (
    <section className="card coming-up" aria-label="Coming up" style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, marginBottom: 6 }}>
        <div className="section-title" style={{ margin: 0 }}>Coming up</div>
        <span className="hint">next 30 days</span>
      </div>
      {warning && (
        <div role="status" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', color: 'var(--amber)', fontSize: 13.5, margin: '6px 0 8px' }}>
          <AlertTriangle size={15} strokeWidth={2} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{warning}</span>
        </div>
      )}
      {items.length > 0 && (
        <ul className="coming-list" id="coming-up-list">
          {shown.map(it => {
            const d = dayParts(it.date)
            const Icon = it.icon
            return (
              <li key={it.key} className={`coming-row${it.event ? ' event' : ''}`}>
                <span className="coming-chip" aria-label={`${d.weekday}, ${d.month} ${d.day}`}><span>{d.month}</span><strong className="mono">{d.day}</strong></span>
                <Icon size={17} strokeWidth={2} aria-hidden="true" className="coming-icon" />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 600, fontSize: 15 }}>{it.title}</span>
                  <span className="hint">{it.sub}</span>
                </span>
              </li>
            )
          })}
        </ul>
      )}
      {more > 0 && (
        <button type="button" className="coming-more" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-controls="coming-up-list">
          {open ? 'Show less' : `Show ${more} more`}
          <ChevronDown size={16} strokeWidth={2} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
        </button>
      )}
      {note && <div className="hint" style={{ marginTop: 8 }}>{note}</div>}
    </section>
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
          <div style={{ width: w(t.open_income), background: 'var(--accent)' }} />
          <div style={{ width: w(t.open_balanced), background: 'var(--violet)' }} />
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
  const [loading,      setLoading]      = useState(true)
  const [loadFailed,   setLoadFailed]   = useState(false)
  const [reloadKey,    setReloadKey]    = useState(0)
  const [reviewCount,  setReviewCount]  = useState(0)   // expired calls that may have been assigned
  const [readyIds,     setReadyIds]     = useState(null) // ids of calls ready to buy back (null = not checked yet)
  const [priceMeta,    setPriceMeta]    = useState(null) // when those prices were checked
  const [evals,        setEvals]        = useState({})   // price check per open call, by id
  const [goal,         setGoal]         = useState(null) // { target, kept, month } when a monthly goal is set
  const [upcoming,     setUpcoming]     = useState(null) // Fed decisions and earnings ahead
  const [eventPct,     setEventPct]     = useState(null) // buy-back target before an event

  useEffect(() => {
    let cancelled = false
    Promise.all([getPortfolio(), getAllPositions()])
      .then(([portRes, posRes]) => {
        if (cancelled) return
        setPortfolio(portRes.data)
        setPositions(posRes.data.filter(p => p.status === 'OPEN'))
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
      .then(r => { if (!cancelled) { setReadyIds(new Set(r.data.positions.filter(e => e.should_buy_back).map(e => e.id))); setEvals(Object.fromEntries(r.data.positions.map(e => [e.id, e]))); setPriceMeta(r.data) } })
      .catch(() => {})
    Promise.all([getStrategy(), getPerformance()])
      .then(([st, perf]) => {
        if (cancelled) return
        setEventPct(st.data.event_buyback_pct)
        if (st.data.monthly_goal > 0) setGoal({ target: st.data.monthly_goal, kept: perf.data.summary.realized_this_month, month: perf.data.summary.month })
      })
      .catch(() => {})
    getUpcoming().then(r => { if (!cancelled) setUpcoming(r.data) }).catch(() => {})
    return () => { cancelled = true }
  }, [reloadKey, applyPortfolio])

  const retry = () => { setLoading(true); setReloadKey(k => k + 1) }

  // After opening fees, same as "Still open" on the Performance page
  const openPremium    = positions.reduce((s, p) => s + p.premium_total - (p.open_fees || 0), 0)
  const totalContracts = portfolio.reduce((s, t) => s + t.total_contracts, 0)
  const working        = portfolio.reduce((s, t) => s + t.open_total, 0)

  const go = (ticker, path) => { selectTicker(ticker); navigate(path) }

  // What needs doing: buybacks, calls expiring within a week, unsold contracts, the monthly goal
  const ready     = readyIds ? positions.filter(p => readyIds.has(p.id)) : []
  const expiring  = positions.filter(p => { const d = daysUntil(p.expiry); return d != null && d >= 0 && d <= 7 })
                      .sort((a, b) => a.expiry.localeCompare(b.expiry))
  const unsold    = portfolio.filter(t => t.available > 0)
  const callList  = list => list.slice(0, 3).map(p => `${p.ticker} ${money(p.strike, 0)}`).join(', ') + (list.length > 3 ? ` and ${list.length - 3} more` : '')

  // Everything that needs you, most urgent first: the first is the Next step, the rest are listed below it
  const todo = []
  if (reviewCount > 0) todo.push({
    key: 'review', icon: AlertTriangle, tone: 'amber',
    title: `Check ${reviewCount === 1 ? 'an expired call' : `${reviewCount} expired calls`}`,
    body: `${reviewCount === 1 ? 'It' : 'They'} expired with the stock above the strike. Were your shares called away?`,
    cta: { label: 'Review', onClick: () => navigate('/positions') },
  })
  if (ready.length > 0) todo.push({
    key: 'ready', icon: BadgeDollarSign, tone: 'green',
    title: ready.length === 1 ? `${ready[0].ticker} ${money(ready[0].strike, 0)} call is ready to buy back` : `${ready.length} calls are ready to buy back`,
    body: ready.length === 1 ? 'You\'ve kept your target share of the premium. Buying back locks it in.' : `You've kept your target share of the premium on ${callList(ready)}.`,
    cta: { label: 'Buy back', onClick: () => navigate('/positions') },
  })
  // Calls with the stock above the strike: buy back at a loss, or let the shares go
  positions.forEach(p => {
    const a = againstYou(p, evals[p.id], portfolio.find(t => t.ticker === p.ticker)?.avg_cost)
    if (!a?.aboveStrike) return
    todo.push({
      key: `above-${p.id}`, icon: ArrowUpRight, tone: 'red',
      title: `${p.ticker} is above your ${money(p.strike, 0)} strike`,
      body: `Buy back for ${a.buybackPL < 0 ? '−' : '+'}${money(Math.abs(a.buybackPL), 0)}, or let ${a.shares.toLocaleString()} shares be called away at ${money(p.strike, 0)} on ${fmtDate(p.expiry)}.`,
      cta: { label: 'Review', onClick: () => go(p.ticker, '/positions') },
    })
  })
  unsold.forEach(t => todo.push({
    key: `unsold-${t.ticker}`, icon: ScanLine, tone: 'accent',
    title: `Put ${plural(t.available, `${t.ticker} contract`)} to work`,
    body: t.open_total === 0
      ? `Your ${t.shares.toLocaleString()} ${t.ticker} shares have no calls sold against them.`
      : `${t.open_total} of ${plural(t.total_contracts, `${t.ticker} contract`)} have a call sold; ${t.available} ${t.available === 1 ? 'is' : 'are'} free.`,
    cta: { label: `Scan ${t.ticker}`, onClick: () => go(t.ticker, '/scanner') },
  }))
  if (expiring.length > 0) todo.push({
    key: 'expiring', icon: CalendarClock, tone: 'blue',
    title: `${plural(expiring.length, 'call')} ${expiring.length === 1 ? 'expires' : 'expire'} within a week`,
    body: expiring.slice(0, 3).map(p => `${p.ticker} ${money(p.strike, 0)} on ${fmtDate(p.expiry)}`).join(', ') + (expiring.length > 3 ? ` and ${expiring.length - 3} more` : ''),
    cta: { label: 'View', onClick: () => navigate('/positions') },
  })
  const [nextStep, ...rest] = todo

  // Coming up (30 days): your calls' expiries, Fed decisions and your stocks' earnings
  const comingUp = useMemo(() => {
    const out = []
    const byCall = new Map()
    positions.forEach(p => {
      const d = daysUntil(p.expiry)
      if (d == null || d < 0 || d > 30) return
      const k = `${p.expiry}|${p.ticker}|${p.strike}`
      byCall.set(k, { ...(byCall.get(k) || { date: p.expiry, ticker: p.ticker, strike: p.strike, contracts: 0 }), contracts: (byCall.get(k)?.contracts || 0) + p.contracts })
    })
    byCall.forEach((c, k) => out.push({ key: `exp-${k}`, date: c.date, icon: Clock3, title: `${c.ticker} ${money(c.strike, 0)} call expires`, sub: plural(c.contracts, 'contract') }))
    ;(upcoming?.fed || []).forEach(day => {
      const after = positions.filter(p => p.expiry >= day).length
      out.push({ key: `fed-${day}`, date: day, event: true, icon: Landmark, title: 'Fed rate decision',
        sub: after ? `${plural(after, 'open call')} ${after === 1 ? 'expires' : 'expire'} after it${eventPct ? `: buy back at ${eventPct}%` : ''}` : 'Can move the whole market' })
    })
    ;(upcoming?.earnings || []).forEach(e => {
      const after = positions.filter(p => p.ticker === e.ticker && p.expiry >= e.date).length
      out.push({ key: `earn-${e.ticker}-${e.date}`, date: e.date, event: true, icon: Megaphone, title: `${e.ticker} earnings`,
        sub: after ? `Before ${plural(after, `open ${e.ticker} call`)} ${after === 1 ? 'expires' : 'expire'}` : 'A stock you hold reports' })
    })
    return out.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key))
  }, [positions, upcoming, eventPct])
  const unknownEarnings = upcoming?.earnings_unknown || []
  const earningsWarning = unknownEarnings.length
    ? `Couldn't check the earnings ${unknownEarnings.length === 1 ? 'date' : 'dates'} for ${unknownEarnings.join(', ')} (Yahoo didn't answer), so ${unknownEarnings.length === 1 ? "it isn't" : "they aren't"} shown here. The app asks again in a few minutes.`
    : null
  const fedNote = upcoming?.fed_known_until && daysUntil(upcoming.fed_known_until) != null && daysUntil(upcoming.fed_known_until) < 30
    ? `Fed dates after ${fmtDate(upcoming.fed_known_until)} aren't in the app's calendar yet.` : null

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
      />

      {loading ? (
        <DashboardSkeleton />
      ) : loadFailed ? (
        <ServerDown onRetry={retry} />
      ) : portfolio.length === 0 ? (
        <GettingStarted onAdd={() => setEditing('new')} />
      ) : (
        <>
          <div className="hero-grid">
            {(() => {
              const goalCard = <GoalCard key="goal" goal={goal}
                numbers={positions.length > 0 && <OpenNumbers openPremium={openPremium} working={working} totalContracts={totalContracts} />} />
              const next = <NextStep key="next" item={nextStep} footer={
                readyIds === null && positions.length > 0
                  ? <span className="hint" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><span className="spinner" style={{ width: 12, height: 12 }} /> Checking which calls are ready to buy back…</span>
                  : readyIds && positions.length > 0 ? <PriceStamp meta={priceMeta} /> : null
              } />
              // Just starting out (no goal, nothing sold): what to do comes first
              return goal || positions.length > 0 ? [goalCard, next] : [next, goalCard]
            })()}
          </div>

          {rest.length > 0 && (
            <div className="card attention" style={{ marginBottom: 20 }}>
              <div className="section-title" style={{ marginBottom: 6 }}>Also needs attention</div>
              {rest.map(it => (
                <Attention key={it.key} icon={it.icon} tone={it.tone}
                  action={<button className="btn-secondary attention-btn" onClick={it.cta.onClick}>{it.cta.label}</button>}>
                  <div style={{ fontWeight: 600, color: 'var(--text)' }}>{it.title}</div>
                  <div className="hint">{it.body}</div>
                </Attention>
              ))}
            </div>
          )}

          <ComingUp items={comingUp} note={fedNote} warning={earningsWarning} />

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
              <span><i style={{ background: 'var(--accent)' }} /> Income <InfoTip text={TERMS.income} size={12} /></span>
              <span><i style={{ background: 'var(--violet)' }} /> Balanced <InfoTip text={TERMS.balanced} size={12} /></span>
              <span><i style={{ background: 'var(--track)' }} /> Not sold</span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
