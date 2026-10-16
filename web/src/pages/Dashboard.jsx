// src/pages/Dashboard.jsx — Home: the one thing to do next, what you've earned from calls
// (once one has finished), your stocks, and what's coming up.
import { useEffect, useId, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowRight, Check, Layers, Pencil, Plus, ScanLine } from 'lucide-react'
import { getAlerts, getAssignmentReview, getOpenPositions, getPerformance, getUpcoming } from '../api/client'
import { useTicker } from '../context/TickerContext'
import { useToast } from '../context/ToastContext'
import { usePageTitle } from '../components/PageHeader'
import ActionMenu from '../components/ActionMenu'
import KeptChart from '../components/KeptChart'
import PriceStamp from '../components/PriceStamp'
import HoldingModal from '../components/dialogs/HoldingModal'
import ServerDown from '../components/ServerDown'
import { DashboardSkeleton } from '../components/Skeleton'
import { Bone, Dot, MarketStatus, Spinner, Stat } from '../components/ui'
import { daysUntil, fmtDate, money, plural, strike } from '../lib/format'
import { needsDecision } from '../lib/pnl'
import { usePriceCheck } from '../lib/usePriceCheck'
import { useStrategy } from '../lib/useStrategy'

// First visit: what the app does, in three steps, and the one thing to do now
function GettingStarted({ onAdd }) {
  const steps = [
    ['Add your stocks', 'The shares you own and what you paid. Every 100 shares lets you sell one call.'],
    ['Scan for a call', 'The Scanner finds calls that fit your rules and recommends one.'],
    ['Track and buy back', 'Positions tells you when to buy back, roll, or let a call expire.'],
  ]
  return (
    <section aria-labelledby="welcome-h" className="max-w-[560px]">
      <h1 id="welcome-h" className="page-title">Welcome to CovCall</h1>
      <p className="mt-2 text-15 text-fg-2">Earn income from shares you already own by selling covered calls.</p>
      <ol className="mt-7 border-b border-line">
        {steps.map(([title, text], i) => (
          <li key={title} className="flex gap-3.5 border-t border-line py-4">
            <span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-13 font-semibold ${i === 0 ? 'bg-accent-soft text-accent' : 'bg-surface text-fg-2'}`}>{i + 1}</span>
            <div><div className="text-17 font-semibold">{title}</div><div className="text-13 text-muted">{text}</div></div>
          </li>
        ))}
      </ol>
      <button type="button" className="btn btn-primary btn-block mt-7 md:inline-flex md:w-auto" onClick={onAdd}>
        <Plus size={16} strokeWidth={2.2} /> Add your first stock
      </button>
    </section>
  )
}

// The one thing to do first, and anything else that needs you under it
function NextStep({ items, checking, priceMeta, className = '' }) {
  const id = useId()
  const [first, ...rest] = items
  return (
    <section aria-labelledby={id} className={`rounded-card bg-surface p-5 md:p-6 ${className}`}>
      <div className="text-13 font-semibold text-accent">Next step</div>
      {first ? (
        <>
          <h2 id={id} className="mt-1.5 text-20 font-semibold tracking-title md:mt-2 md:text-22">{first.title}</h2>
          <p className="mt-1.5 text-15 text-fg-2">{first.body}{first.more ? `. ${first.more}` : ''}</p>
          <button type="button" className="btn btn-primary btn-block mt-5" onClick={first.cta.onClick}>
            {first.cta.label} <ArrowRight size={16} strokeWidth={2.2} />
          </button>
        </>
      ) : (
        <>
          <h2 id={id} className="mt-1.5 flex items-center gap-2 text-20 font-semibold tracking-title md:text-22">
            <Check size={22} strokeWidth={2.4} className="text-accent" aria-hidden="true" /> All caught up
          </h2>
          <p className="mt-1.5 text-15 text-fg-2">Every contract is working and nothing needs you right now.</p>
        </>
      )}
      {rest.map(it => (
        <div key={it.key} className="mt-4 flex items-center gap-3 border-t border-line-2 pt-3">
          {(it.tone === 'amber' || it.tone === 'loss') && <Dot tone={it.tone} />}
          <div className="min-w-0 flex-1">
            <div className="text-15 font-medium">{it.title}</div>
            <div className="text-13 text-muted">{it.body}</div>
          </div>
          <button type="button" className="link min-h-11 shrink-0" onClick={it.cta.onClick}>{it.cta.label}</button>
        </div>
      ))}
      {checking
        ? <p className="mt-4 flex items-center gap-2 text-12 text-muted"><Spinner className="h-3 w-3" /> Checking which calls are ready to buy back…</p>
        : <PriceStamp meta={priceMeta} className="mt-4" />}
    </section>
  )
}

// "Coming up": expiries, Fed decisions and earnings over the next 30 days. Three show,
// earnings and Fed decisions first (expiries are also on Positions); the rest open with "See all".
const SHOWN = 3
function ComingUp({ items, note, warning, className = '' }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  if (!items.length && !warning) return null
  const picked = new Set([...items.filter(i => i.event), ...items.filter(i => !i.event)].slice(0, SHOWN).map(i => i.key))
  const shown = open ? items : items.filter(i => picked.has(i.key))
  return (
    <section aria-labelledby={id} className={className}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={id} className="text-20 font-semibold tracking-title md:text-17">Coming up</h2>
        {items.length > SHOWN && (
          <button type="button" className="link link-quiet min-h-11 text-13" aria-expanded={open} onClick={() => setOpen(o => !o)}>
            {open ? 'Show less' : `See all ${items.length}`}
          </button>
        )}
      </div>
      {warning && <p role="status" className="mt-2 flex gap-2 text-13 text-fg-2"><Dot tone="amber" className="mt-1.5" />{warning}</p>}
      {items.length > 0 && (
        <ul className="mt-1">
          {shown.map(it => {
            const [y, m, d] = it.date.split('-').map(Number)
            const day = new Date(y, m - 1, d)
            return (
              <li key={it.key} className="flex items-center gap-4 border-b border-line py-3.5 last:border-b-0">
                <span className="w-9 shrink-0 text-center leading-tight" aria-label={day.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}>
                  <span className="block text-11 font-semibold tracking-wide text-muted">{day.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()}</span>
                  <span className="block text-17 font-semibold">{d}</span>
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-15 font-medium">{it.event && <Dot tone="amber" />}{it.title}</span>
                  <span className="block text-13 text-muted">{it.sub}</span>
                </span>
              </li>
            )
          })}
        </ul>
      )}
      {note && <p className="mt-2 text-12 text-muted">{note}</p>}
    </section>
  )
}

// One stock: how many of its contracts have a call sold, and what's open on it
function Coverage({ total, working }) {
  if (total > 12) {
    return (
      <span className="inline-flex h-1.5 w-20 overflow-hidden rounded-full bg-track" aria-hidden="true">
        <span className="h-full rounded-full bg-accent" style={{ width: `${(working / total) * 100}%` }} />
      </span>
    )
  }
  return (
    <span className="inline-flex gap-[3px]" aria-hidden="true">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`h-3 w-[5px] rounded-[2px] md:h-4 md:w-1.5 ${i < working ? 'bg-accent' : 'bg-track'}`} />
      ))}
    </span>
  )
}

function StockRow({ t, positions, onScan, onPositions, onEdit }) {
  const open = positions.reduce((s, p) => s + p.premium_total - (p.open_fees || 0), 0)
  const total = t.total_contracts || 0
  return (
    <li className="flex items-center gap-3 border-b border-line py-4 md:gap-6">
      <div className="min-w-0 flex-1 md:flex md:items-center md:gap-6">
        <div className="md:w-[220px] md:shrink-0">
          <div className="text-17 font-semibold">{t.ticker}</div>
          <div className="hidden text-13 text-muted md:block">{t.shares.toLocaleString()} shares{t.avg_cost > 0 ? ` · bought at ${money(t.avg_cost)}` : ''}</div>
        </div>
        <div className="mt-1.5 flex items-center gap-2 md:mt-0 md:flex-1 md:gap-3">
          <Coverage total={total} working={t.open_total} />
          <span className="text-13 text-muted md:text-fg-2">{!total ? 'Under 100 shares' : t.open_total === 0 ? `${t.shares.toLocaleString()} shares · none covered yet` : `${t.open_total} of ${total} covered`}</span>
        </div>
      </div>
      {t.available > 0 ? (
        <button type="button" className="btn btn-primary btn-sm min-h-11 md:min-h-10" onClick={onScan}>
          Find a call
        </button>
      ) : (
        <div className="text-right">
          <div className="text-15 font-semibold">{money(open)}</div>
          <div className="text-13 text-muted">open premium</div>
        </div>
      )}
      <ActionMenu label={`Actions for ${t.ticker}`} className="-mr-2" items={[
        { label: 'View positions', icon: Layers, onClick: onPositions },
        { label: 'Scan for a call', icon: ScanLine, onClick: onScan },
        { label: 'Edit shares or cost', icon: Pencil, onClick: onEdit },
      ]} />
    </li>
  )
}

export default function Dashboard() {
  usePageTitle('Home')
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  // Your stocks come from the shared list (refreshed on every visit), the strategy from its shared copy
  const { tickers: portfolio, loaded: portfolioLoaded, loadError: portfolioFailed, selectTicker, applyPortfolio, refresh: refreshPortfolio } = useTicker()
  const strategy = useStrategy()
  const toast = useToast()
  // null | 'new' | a holding row; /?add=1 (from Scanner or Positions) opens 'Add a stock'
  const [editing,      setEditing]      = useState(() => (params.get('add') === '1' ? 'new' : null))
  const [reloadKey,    setReloadKey]    = useState(0)
  const [openCalls,    setOpenCalls]    = useState({ key: -1, list: [], failed: false })
  const [reviewCount,  setReviewCount]  = useState(0)   // expired calls that may have been assigned
  const [perf,         setPerf]         = useState(null) // /performance: finished calls for the chart
  const [upcoming,     setUpcoming]     = useState(null) // Fed decisions and earnings ahead
  const [alertsState,  setAlertsState]  = useState(null) // Discord alerts: stopped, or failing?

  useEffect(() => {
    let cancelled = false
    refreshPortfolio({ maxAge: 30000 }).catch(() => {})
    getOpenPositions()
      .then(r => { if (!cancelled) setOpenCalls({ key: reloadKey, list: r.data, failed: false }) })
      .catch(() => { if (!cancelled) setOpenCalls({ key: reloadKey, list: [], failed: true }) })
    getAssignmentReview()
      .then(r => { if (!cancelled) setReviewCount(r.data.length) })
      .catch(() => {})
    // Without it there's no chart, but the next step still shows
    getPerformance().then(r => { if (!cancelled) setPerf(r.data) }).catch(() => { if (!cancelled) setPerf({ trades: [] }) })
    getUpcoming().then(r => { if (!cancelled) setUpcoming(r.data) }).catch(() => {})
    getAlerts().then(r => { if (!cancelled) setAlertsState(r.data) }).catch(() => {})
    return () => { cancelled = true }
  }, [reloadKey, refreshPortfolio])

  const positions  = openCalls.list
  const loading    = openCalls.key !== reloadKey || !portfolioLoaded
  const loadFailed = openCalls.failed || (portfolioFailed && portfolio.length === 0)
  const retry = () => setReloadKey(k => k + 1)
  const goal     = strategy?.monthly_goal > 0 ? strategy.monthly_goal : 0
  const eventPct = strategy?.event_buyback_pct ?? null

  // Live option prices are slower, so they fill in after the page shows (shared with Positions)
  const prices    = usePriceCheck(loading ? [] : positions.map(p => p.id))
  const priceMeta = prices.data
  const evals     = useMemo(() => Object.fromEntries((prices.data?.positions || []).map(e => [e.id, e])), [prices.data])
  const readyIds  = prices.data ? new Set(prices.data.positions.filter(e => e.should_buy_back).map(e => e.id)) : null

  // After opening fees, same as "Still open" on the Performance page
  const openPremium    = positions.reduce((s, p) => s + p.premium_total - (p.open_fees || 0), 0)
  const totalContracts = portfolio.reduce((s, t) => s + t.total_contracts, 0)
  const working        = portfolio.reduce((s, t) => s + t.open_total, 0)
  const free           = totalContracts - working

  const go = (ticker, path) => { selectTicker(ticker); navigate(path) }

  // What needs doing: buybacks, calls expiring within a week, unsold contracts
  const ready     = readyIds ? positions.filter(p => readyIds.has(p.id)) : []
  const expiring  = positions.filter(p => { const d = daysUntil(p.expiry); return d != null && d >= 0 && d <= 7 })
                      .sort((a, b) => a.expiry.localeCompare(b.expiry))
  const unsold    = portfolio.filter(t => t.available > 0)
  const callList  = list => list.slice(0, 3).map(p => `${p.ticker} ${strike(p.strike)}`).join(' and ') + (list.length > 3 ? ` and ${list.length - 3} more` : '')

  // Everything that needs you, most urgent first: the first is the Next step, the rest are listed under it
  const todo = []
  if (reviewCount > 0) todo.push({
    key: 'review', tone: 'amber',
    title: `Check ${reviewCount === 1 ? 'an expired call' : `${reviewCount} expired calls`}`,
    body: `${reviewCount === 1 ? 'It' : 'They'} expired with the stock above the strike. Were your shares sold?`,
    cta: { label: 'Review', onClick: () => navigate('/positions') },
  })
  if (ready.length > 0) todo.push({
    key: 'ready',
    title: ready.length === 1 ? `${ready[0].ticker} ${strike(ready[0].strike)} call is ready to buy back` : `${ready.length} calls are ready to buy back`,
    body: ready.length === 1 ? "You've kept your target share of the premium. Buying back locks it in." : `You've kept your target share of the premium on ${callList(ready)}.`,
    cta: { label: ready.length === 1 ? 'Review buy back' : 'Review buy backs', onClick: () => navigate('/positions') },
  })
  // Calls that need a decision (the stock near or above the strike): buy back, roll or let the
  // shares go. One likely to be exercised early for the dividend says by when to act instead.
  positions.forEach(p => {
    const early = evals[p.id]?.early_exercise
    if (early) {
      todo.push({
        key: `early-${p.id}`, tone: 'loss',
        title: `${p.ticker} ${strike(p.strike)} call may be exercised early`,
        body: `${p.ticker} goes ex-dividend on ${fmtDate(early.ex_dividend_date)}, and the call has less time value left than the dividend. To keep your shares, buy back or roll by ${fmtDate(early.exercise_by)}.`,
        cta: { label: 'Review', onClick: () => go(p.ticker, '/positions') },
      })
      return
    }
    const d = needsDecision(p, evals[p.id], portfolio.find(t => t.ticker === p.ticker)?.avg_cost)
    if (!d) return
    todo.push({
      key: `decide-${p.id}`, tone: d.aboveStrike ? 'loss' : 'amber',
      title: `${p.ticker} is ${d.aboveStrike ? 'above' : 'near'} your ${strike(p.strike)} strike`,
      body: `If it closes above ${strike(p.strike)} on ${fmtDate(p.expiry)}, your ${d.shares.toLocaleString()} shares are sold at ${strike(p.strike)}. Buy back, roll, or let them go.`,
      cta: { label: 'Decide', onClick: () => go(p.ticker, '/positions') },
    })
  })
  // Shares with no call sold on several stocks: one step that scans them all
  if (unsold.length > 1) todo.push({
    key: 'unsold',
    title: `Calls to sell on ${unsold.length} stocks`,
    body: unsold.map(t => `${(t.available * 100).toLocaleString()} ${t.ticker} shares not covered`).join(' · '),
    more: 'Scan them all at once for the trade on each.',
    cta: { label: 'Scan all', onClick: () => navigate('/scanner?all=1&go=1') },
  })
  else unsold.forEach(t => todo.push({
    key: `unsold-${t.ticker}`,
    title: t.open_total === 0 ? `Sell a call on your ${t.ticker} shares` : `${(t.available * 100).toLocaleString()} ${t.ticker} shares not covered`,
    body: t.open_total === 0 ? `${t.shares.toLocaleString()} shares, enough for ${plural(t.available, 'call')}` : `Enough for ${plural(t.available, 'more call')}`,
    more: 'CovCall finds one that fits you and shows exactly what to enter at your broker.',
    cta: { label: 'Find a call', onClick: () => go(t.ticker, '/scanner?go=1') },
  }))
  // Discord alerts that have quietly stopped working
  if (alertsState?.enabled && (alertsState.last_error || alertsState.check_overdue)) todo.push({
    key: 'alerts', tone: 'amber',
    title: alertsState.last_error ? "Discord alerts aren't getting through" : 'Discord alerts have stopped checking',
    body: alertsState.last_error ? alertsState.last_error : 'The scheduled check hasn\'t run lately, so no alerts can be sent.',
    cta: { label: 'Check', onClick: () => navigate('/strategy') },
  })
  if (expiring.length > 0) todo.push({
    key: 'expiring',
    title: `${plural(expiring.length, 'call')} ${expiring.length === 1 ? 'expires' : 'expire'} within a week`,
    body: expiring.slice(0, 3).map(p => `${p.ticker} ${strike(p.strike)} on ${fmtDate(p.expiry)}`).join(', ') + (expiring.length > 3 ? ` and ${expiring.length - 3} more` : ''),
    cta: { label: 'View', onClick: () => navigate('/positions') },
  })

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
    byCall.forEach((c, k) => out.push({ key: `exp-${k}`, date: c.date, title: `${c.ticker} ${strike(c.strike)} call expires`, sub: plural(c.contracts, 'contract') }))
    ;(upcoming?.fed || []).forEach(day => {
      const after = positions.filter(p => p.expiry >= day).length
      out.push({ key: `fed-${day}`, date: day, event: true, title: 'Fed rate decision',
        sub: after ? `${plural(after, 'call')} ${after === 1 ? 'expires' : 'expire'} after it${eventPct ? `: buy back at ${eventPct}%` : ''}` : 'Can move the whole market' })
    })
    ;(upcoming?.earnings || []).forEach(e => {
      const after = positions.filter(p => p.ticker === e.ticker && p.expiry >= e.date).length
      const held = portfolio.find(t => t.ticker === e.ticker)
      out.push({ key: `earn-${e.ticker}-${e.date}`, date: e.date, event: true, title: `${e.ticker} earnings`,
        sub: after ? `Before ${plural(after, `${e.ticker} call`)} ${after === 1 ? 'expires' : 'expire'}` : held ? `You hold ${held.shares.toLocaleString()} shares` : 'A stock you hold reports' })
    })
    return out.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key))
  }, [positions, portfolio, upcoming, eventPct])
  const unknownEarnings = upcoming?.earnings_unknown || []
  const earningsWarning = unknownEarnings.length
    ? `Couldn't check the earnings ${unknownEarnings.length === 1 ? 'date' : 'dates'} for ${unknownEarnings.join(', ')}. The app asks again in a few minutes.`
    : null
  const fedNote = upcoming?.fed_known_until && daysUntil(upcoming.fed_known_until) != null && daysUntil(upcoming.fed_known_until) < 30
    ? `Fed dates after ${fmtDate(upcoming.fed_known_until)} aren't in the app's calendar yet.` : null

  const closeEditor = () => {
    setEditing(null)
    if (params.has('add')) setParams({}, { replace: true })
  }

  // The API returns the updated portfolio after every add/edit/remove. A new stock with shares
  // to cover goes straight to its scan.
  const handleSaved = (rows, ticker) => {
    applyPortfolio(rows)
    toast(editing === 'new' ? `${ticker} added` : ticker ? `${ticker} updated` : `${editing.ticker} removed`)
    const added = editing === 'new' && ticker ? rows.find(t => t.ticker === ticker) : null
    closeEditor()
    if (added) {
      selectTicker(ticker)
      if (added.available > 0) navigate('/scanner?go=1')
    }
  }

  const checking = prices.checking && !prices.data
  const nextStep = <NextStep items={todo} checking={checking} priceMeta={positions.length > 0 ? priceMeta : null} />
  const coming = <ComingUp items={comingUp} note={fedNote} warning={earningsWarning} />
  const yearly = perf?.summary?.annualized_return_pct
  // Until a call has finished there's nothing to chart, so the next step leads; the numbers
  // under the chart wait for a call, and the options-approval note is for the very start
  const finished = perf ? perf.trades.length > 0 : null
  const anyCalls = positions.length > 0 || !!finished

  return (
    <div className="page">
      <h1 className="sr-only">Home</h1>
      {editing && <HoldingModal holding={editing === 'new' ? null : editing} onClose={closeEditor} onSaved={handleSaved} />}
      <div className="mb-4 flex min-h-8 items-center md:hidden"><MarketStatus /></div>

      {loading ? (
        <DashboardSkeleton />
      ) : loadFailed ? (
        <ServerDown onRetry={retry} />
      ) : portfolio.length === 0 ? (
        <GettingStarted onAdd={() => setEditing('new')} />
      ) : (
        <div className="md:grid md:grid-cols-[minmax(0,1fr)_320px] md:items-start md:gap-12">
          <div className="min-w-0">
            {finished === null ? (
              <div aria-hidden="true">
                <Bone className="h-4 w-28" /><Bone className="mt-3 h-12 w-56" /><Bone className="mt-3 h-4 w-64" />
                <div className="h-[260px] md:h-[318px]" />
              </div>
            ) : finished ? (
              <KeptChart trades={perf.trades} goal={goal} />
            ) : (
              <div className="md:max-w-[560px]">
                {nextStep}
                {!anyCalls && (
                  <p className="mt-4 flex items-start gap-2.5 rounded-card border border-edge p-4 text-13 text-fg-2">
                    <Dot tone="amber" className="mt-1.5" />
                    <span><strong className="font-semibold text-fg">First time selling calls?</strong> Your broker has to approve you for options first, usually the lowest level ("covered calls"). Most approve it within a day.</span>
                  </p>
                )}
              </div>
            )}

            {finished && <div className="mt-8 md:hidden">{nextStep}</div>}

            {anyCalls && (
              <section aria-label="Open calls" className="mt-8 grid grid-cols-3 border-y border-line">
                <Stat className="py-4 pr-3 md:py-5 md:pr-5" label="In open calls" value={money(openPremium)}
                  sub={`${plural(positions.length, 'call')}${positions.length ? ', after fees' : ''}`} />
                <Stat className="border-l border-line py-4 px-3 md:p-5" label="Contracts working"
                  value={<>{working} <span className="font-medium text-muted">/ {totalContracts}</span></>}
                  sub={free > 0 ? `${(free * 100).toLocaleString()} shares not covered` : 'All covered'} />
                <Stat className="border-l border-line py-4 pl-3 md:p-5" label="Yearly return"
                  value={yearly == null ? '—' : `${yearly.toFixed(1)}%`} sub="on what your shares cost" />
              </section>
            )}

            <section aria-labelledby="stocks-h" className="mt-10">
              <div className="flex items-center justify-between gap-3">
                <h2 id="stocks-h" className="text-20 font-semibold tracking-title">Your stocks</h2>
                <button type="button" className="btn btn-secondary btn-sm hidden md:inline-flex" onClick={() => setEditing('new')}>
                  <Plus size={15} strokeWidth={2.2} /> Add stock
                </button>
                <button type="button" className="icon-btn -mr-2.5 text-fg md:hidden" aria-label="Add stock" onClick={() => setEditing('new')}>
                  <Plus size={22} strokeWidth={2} />
                </button>
              </div>
              <ul className="mt-1">
                {portfolio.map(t => (
                  <StockRow key={t.ticker} t={t} positions={positions.filter(p => p.ticker === t.ticker)}
                    onScan={() => go(t.ticker, t.available > 0 ? '/scanner?go=1' : '/scanner')} onPositions={() => go(t.ticker, '/positions')} onEdit={() => setEditing(t)} />
                ))}
              </ul>
            </section>

            <div className="mt-10 md:hidden">{coming}</div>
            {finished === false && <p className="mt-8 text-13 text-muted">"Earned from calls" and its chart appear here once your first call finishes.</p>}
          </div>

          <aside className="hidden md:flex md:flex-col md:gap-10">
            {finished && nextStep}
            {coming}
          </aside>
        </div>
      )}
    </div>
  )
}
