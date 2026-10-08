// src/pages/Positions.jsx
// One place for your covered calls: what's open, whether to buy back, and history.
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  apiError, assignPosition, deletePosition, getAllPositions, getAssignmentReview, getManagement, undoPosition,
} from '../api/client'
import { useTicker } from '../context/TickerContext'
import { useToast } from '../context/ToastContext'
import { ChevronRight, Copy, Layers, Pencil, Plus, RefreshCw, Repeat, ScanLine, Trash2, Undo2, UserCheck } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import ServerDown from '../components/ServerDown'
import EmptyState, { AddStockLink } from '../components/EmptyState'
import { PositionsSkeleton } from '../components/Skeleton'
import StockChips from '../components/StockChips'
import { useStrategy, chargesCommission } from '../lib/useStrategy'
import ActionMenu from '../components/ActionMenu'
import AssignmentReview from '../components/AssignmentReview'
import CloseModal from '../components/dialogs/CloseModal'
import RollModal from '../components/dialogs/RollModal'
import EditTradeModal from '../components/dialogs/EditTradeModal'
import AddCallModal from '../components/dialogs/AddCallModal'
import ConfirmDialog from '../components/dialogs/ConfirmDialog'
import PriceStamp from '../components/PriceStamp'
import { Dot, KeptBar, Segmented, Spinner } from '../components/ui'
import { fmtDate, daysUntil, money, plural, signedMoney, strike } from '../lib/format'
import { againstYou, optionNet, resultLabel } from '../lib/pnl'

const SCOPE_KEY = 'positions_scope'
const loadScope = () => { try { return localStorage.getItem(SCOPE_KEY) === 'stock' ? 'stock' : 'all' } catch { return 'all' } }
const saveScope = s => { try { localStorage.setItem(SCOPE_KEY, s) } catch { /* storage unavailable */ } }

const callName = (p, showTicker) => `${showTicker ? `${p.ticker} ` : ''}${strike(p.strike)} call`
const daysLeft = p => {
  const d = daysUntil(p.expiry)
  return d === 0 ? 'expires today' : d > 0 ? `${plural(d, 'day')} left` : 'expired'
}

// Copy the buy-back price, ready to paste into a limit order at your broker
function CopyPrice({ price }) {
  const toast = useToast()
  const copy = async () => {
    try { await navigator.clipboard.writeText(price.toFixed(2)); toast(`Copied ${money(price)}`) }
    catch { toast(`Buy-back price: ${money(price)}`) }
  }
  return (
    <button type="button" className="icon-btn icon-btn-sm -my-2 -ml-0.5" onClick={copy} aria-label={`Copy the buy-back price, ${money(price)}`}>
      <Copy size={15} strokeWidth={2} />
    </button>
  )
}

// The call costs more than you sold it for: the two real choices, in dollars
function AgainstYou({ p, a }) {
  const tone = v => (v < 0 ? 'var(--loss)' : 'var(--accent)')
  return (
    <div className="mt-4">
      <p className="flex items-start gap-2 text-13 text-fg-2">
        <Dot tone={a.aboveStrike ? 'loss' : 'amber'} className="mt-1.5" />
        <span>
          <strong className="font-semibold text-fg">{a.aboveStrike ? 'Stock above your strike.' : 'The call is up.'}</strong>{' '}
          {p.ticker} {money(a.stock)}, {a.fromStrikePct.toFixed(1)}% {a.aboveStrike ? 'above' : 'below'} the strike. The call is {money(a.now)}; you sold it at {money(p.entry_price)}.
          {!a.aboveStrike && <> If {p.ticker} stays under {strike(p.strike)} until {fmtDate(p.expiry)}, it expires worthless and you keep all {money(a.collected)}.</>}
        </span>
      </p>
      <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
        <div className="rounded-sm bg-panel p-4">
          <div className="text-13 text-fg-2">Buy back now</div>
          <div className="mt-0.5 text-20 font-semibold tracking-title" style={{ color: tone(a.buybackPL) }}>{signedMoney(a.buybackPL, 0)}</div>
          <div className="mt-1 text-13 text-muted">Costs {money(a.buybackCost)} against the {money(a.collected)} collected. You keep your shares.</div>
        </div>
        <div className="rounded-sm bg-panel p-4">
          <div className="text-13 text-fg-2">{a.aboveStrike ? 'Let it be called away' : `If it's called away at ${strike(p.strike)}`}</div>
          {a.calledPL != null ? (
            <>
              <div className="mt-0.5 text-20 font-semibold tracking-title" style={{ color: tone(a.calledPL) }}>{signedMoney(a.calledPL, 0)}</div>
              <div className="mt-1 text-13 text-muted">
                {a.shares.toLocaleString()} shares sold at {money(p.strike)}: {money(a.collected)} premium {a.shareGain >= 0 ? '+' : '−'} {money(Math.abs(a.shareGain))} {a.shareGain >= 0 ? 'over' : 'under'} your {money(a.cost)} cost.
              </div>
            </>
          ) : (
            <div className="mt-1 text-13 text-muted">{a.shares.toLocaleString()} shares sold at {money(p.strike)}, and you keep the {money(a.collected)} premium. Add your average cost to the stock to see the total.</div>
          )}
        </div>
      </div>
      {a.aboveStrike && a.upsideGiven > 0 && (
        <p className="mt-2 text-13 text-muted">
          At today's price, {money(a.upsideGiven, 0)} of {p.ticker}'s rise above {strike(p.strike)} goes to the buyer. Buying back keeps that upside.
        </p>
      )}
    </div>
  )
}

// What the latest price check says about one call
function Status({ p, ev, checking, failed, avgCost }) {
  const withFees = chargesCommission(useStrategy()) ? ' with fees' : ''
  if (!ev) {
    return (
      <p className="mt-4 flex items-center gap-2 text-13 text-muted">
        {checking ? <><Spinner className="h-3.5 w-3.5" /> Checking the price…</> : failed ? "Couldn't check prices." : 'No price data for this call.'}
      </p>
    )
  }
  if (!(ev.current_option_price > 0)) {
    return (
      <p className="mt-4 text-13 text-muted">
        {ev.old_trade_date
          ? <>No current price: it last traded on {fmtDate(ev.old_trade_date)}, when the stock was elsewhere. Check again once the market opens.</>
          : "Couldn't get a price for this call right now (common outside market hours). Check again while the market is open."}
      </p>
    )
  }
  const against = againstYou(p, ev, avgCost)
  if (against) return <AgainstYou p={p} a={against} />

  const buy = ev.should_buy_back
  const expire = ev.action === 'let_expire'
  const evText = ev.event ? `${ev.event.kind === 'earnings' ? `${p.ticker} reports` : 'The Fed decides'} on ${fmtDate(ev.event.date)}` : null
  const below = ev.stock_price > 0 ? (1 - ev.stock_price / ev.strike) * 100 : null
  const target = ev.buyback_kept_pct
  return (
    <>
      <KeptBar className="mt-4" pct={ev.profit_capture_pct} target={target} event={!!ev.event} hot={buy || expire} />
      <div className="relative mt-1 h-4 text-11 text-muted" aria-hidden="true">
        {target > 0 && <span className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${Math.min(Math.max(target, 12), 88)}%` }}>target {Math.round(target)}%</span>}
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-3">
        <div>
          <dt className="text-12 text-muted">Limit price</dt>
          <dd className="mt-0.5 flex items-center text-17 font-semibold">
            {ev.buyback_price > 0 ? <>{money(ev.buyback_price)}<CopyPrice price={ev.buyback_price} /></> : '—'}
          </dd>
        </div>
        <div><dt className="text-12 text-muted">Price now</dt><dd className="mt-0.5 text-17 font-semibold">{money(ev.current_option_price)}</dd></div>
        <div><dt className="text-12 text-muted">Costs about</dt><dd className="mt-0.5 text-17 font-semibold">{money(ev.cost_to_close)}</dd></div>
      </dl>
      <p className="mt-3 flex items-start gap-2 text-13 text-fg-2">
        {ev.event && <Dot tone="amber" className="mt-1.5" />}
        <span>
          {buy && evText
            ? <>{evText}, before this call expires, so the target drops to {ev.target_pct}%.</>
            : buy
              ? <>Buying back now locks in the gain{withFees ? `, including fees` : ''}.</>
              : expire
                ? <>Expires in {plural(ev.days_left, 'day')} with the stock {below.toFixed(0)}% under the strike. Buying back would cost {money(ev.cost_to_close)}{withFees} for little benefit, so you can let it expire.</>
                : <>Not worth buying back yet{evText ? <>. {evText} before expiry, so you'll be told to buy back at {ev.target_pct}%</> : ''}.</>}
        </span>
      </p>
    </>
  )
}

function PositionCard({ p, showTicker, ev, checking, failed, avgCost, onClose, onRoll, onEdit, onDelete, onCollapse }) {
  const buy = ev?.should_buy_back
  const against = againstYou(p, ev, avgCost)
  const priced = ev && ev.current_option_price > 0 && !against
  return (
    <article aria-label={`${p.ticker} ${strike(p.strike)} call`} className="rounded-card bg-surface p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-17 font-semibold">{callName(p, showTicker)}</h3>
        {priced && <span className="text-17 font-semibold" style={{ color: buy || ev.action === 'let_expire' ? 'var(--accent)' : undefined }}>{Math.round(ev.profit_capture_pct)}%</span>}
      </div>
      <div className="mt-0.5 flex justify-between gap-3 text-13 text-muted">
        <span>{plural(p.contracts, 'contract')} · {fmtDate(p.expiry)} · {daysLeft(p)}</span>
        {priced && <span>kept</span>}
      </div>
      <div className="mt-0.5 text-13 text-muted">
        {p.allocation_type}{p.rolled_from ? ' · rolled' : ''} · sold at {money(p.entry_price)} · collected {money(p.premium_total)}
      </div>

      <Status p={p} ev={ev} checking={checking} failed={failed} avgCost={avgCost} />

      <div className="mt-5 flex items-center gap-2.5">
        <button type="button" className="btn btn-secondary flex-1" onClick={() => onRoll(p)}>
          <Repeat size={16} strokeWidth={2} /> Roll
        </button>
        <button type="button" className={`btn flex-[2] ${buy ? 'btn-primary' : 'btn-secondary'}`} onClick={() => onClose(p)}>
          {buy ? 'Buy back' : 'Close'}
        </button>
        <ActionMenu label={`More for the ${p.ticker} ${strike(p.strike)} call`} className="-mr-2" items={[
          onCollapse && { label: 'Show less', icon: ChevronRight, onClick: onCollapse },
          { label: 'Edit fill or fees', icon: Pencil, onClick: () => onEdit(p) },
          // A rolled call is undone from History so the original call reopens
          !p.rolled_from && { label: 'Delete (entered by mistake)', icon: Trash2, danger: true, onClick: () => onDelete(p) },
        ]} />
      </div>
    </article>
  )
}

// One line for a call that needs nothing from you right now: premium kept against the target
function CallRow({ p, showTicker, ev, checking, failed, onExpand }) {
  const priced = ev && ev.current_option_price > 0
  const expire = ev?.action === 'let_expire'
  return (
    <li className="border-b border-line last:border-b-0">
      <button type="button" className="flex w-full items-center gap-3 py-3.5 text-left" onClick={onExpand} aria-expanded="false"
        aria-label={`${callName(p, true)}, ${priced ? `${Math.round(ev.profit_capture_pct)}% kept` : 'no current price'}. Show details`}>
        <span className="min-w-0 flex-1">
          <span className="block text-15 font-medium">{callName(p, showTicker)}</span>
          <span className="block text-13 text-muted">{plural(p.contracts, 'contract')} · {fmtDate(p.expiry)}{expire ? ' · let it expire' : ''}</span>
        </span>
        {priced ? (
          <span className="w-[76px] shrink-0">
            <span className="block text-right text-15 font-semibold" style={{ color: expire ? 'var(--accent)' : undefined }}>{Math.round(ev.profit_capture_pct)}%</span>
            <KeptBar className="mt-1.5" height={4} pct={ev.profit_capture_pct} target={ev.buyback_kept_pct} event={!!ev.event} hot={expire} />
          </span>
        ) : (
          <span className="text-13 text-muted">{checking && !ev ? <Spinner className="h-3.5 w-3.5" /> : failed && !ev ? 'No price' : '—'}</span>
        )}
        <ChevronRight size={16} strokeWidth={2} className="shrink-0 text-muted" aria-hidden="true" />
      </button>
    </li>
  )
}

export default function Positions() {
  const { selected, tickers, selectTicker, refresh: refreshTickers } = useTicker()
  const toast = useToast()
  const [params] = useSearchParams()
  const [tab, setTab]         = useState(params.get('tab') === 'history' ? 'CLOSED' : 'OPEN')
  const [scope, setScopeState] = useState(() => params.get('scope') === 'all' ? 'all' : params.get('scope') === 'stock' ? 'stock' : loadScope())
  const setScope = s => { setScopeState(s); saveScope(s) }

  const [reloadKey, setReloadKey] = useState(0)
  const [fetched, setFetched]     = useState({ key: null, positions: [] })
  const [review, setReview]       = useState([])       // expired calls that may have been assigned
  const [error, setError]         = useState(null)

  const [closingPos, setClosingPos] = useState(null)   // Close dialog
  const [rollingPos, setRollingPos] = useState(null)   // Roll dialog
  const [editingPos, setEditingPos] = useState(null)   // Edit dialog
  const [adding, setAdding]       = useState(false)    // Add a call dialog
  const [confirm, setConfirm]     = useState(null)     // { title, body, confirmLabel, danger, run }
  const [expanded, setExpanded]   = useState(() => new Set())  // held calls opened to their full card
  const toggleExpanded = id => setExpanded(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  // Load every trade (all stocks, incl. ones you've removed); filter on screen
  const fetchKey = String(reloadKey)
  useEffect(() => {
    let cancelled = false
    getAllPositions()
      .then(r => { if (!cancelled) setFetched({ key: fetchKey, positions: r.data }) })
      .catch(() => { if (!cancelled) setFetched({ key: fetchKey, positions: [], failed: true }) })
    // Needs stock prices from Yahoo, so it loads separately and never blocks the page
    getAssignmentReview()
      .then(r => { if (!cancelled) setReview(r.data) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [fetchKey])

  const loading   = fetched.key !== fetchKey
  const positions = fetched.positions
  const reload    = () => setReloadKey(k => k + 1)

  const inScope   = p => scope === 'all' || p.ticker === selected
  const open      = positions.filter(p => p.status === 'OPEN' && inScope(p))
  const closed    = positions.filter(p => p.status !== 'OPEN' && inScope(p))
    .slice().sort((a, b) => (b.closed_at || '').localeCompare(a.closed_at || '') || b.id - a.id)
  const rolledIds = new Set(positions.filter(p => p.rolled_from).map(p => p.rolled_from))
  const showTicker = scope === 'all'

  // Prices are checked automatically whenever the open calls change; "Refresh" re-checks
  const [refreshKey, setRefreshKey] = useState(0)
  const [prices, setPrices] = useState({ key: null, evals: null, failed: false, meta: null })
  const checkTicker = scope === 'all' ? null : selected
  const priceKey = `${fetchKey}|${checkTicker}|${refreshKey}`
  const hasOpen = !loading && open.length > 0
  useEffect(() => {
    if (!hasOpen) return
    let cancelled = false
    getManagement(checkTicker)
      .then(r => { if (!cancelled) setPrices({ key: priceKey, evals: Object.fromEntries(r.data.positions.map(e => [e.id, e])), failed: false, meta: r.data }) })
      .catch(e => { if (!cancelled) { setPrices({ key: priceKey, evals: null, failed: true }); setError(apiError(e, 'Could not check prices. Is the API running?')) } })
    return () => { cancelled = true }
  }, [priceKey, hasOpen, checkTicker])
  const checking = hasOpen && prices.key !== priceKey
  const evals = prices.key === priceKey ? prices.evals : null
  const readyCount = evals ? open.filter(p => evals[p.id]?.should_buy_back).length : 0
  const expireCount = evals ? open.filter(p => evals[p.id]?.action === 'let_expire').length : 0

  // After any change to a call: reload trades and the portfolio (contracts in use, shares)
  const afterChange = () => {
    setClosingPos(null); setRollingPos(null); setEditingPos(null); setConfirm(null); setError(null)
    reload()
    refreshTickers().catch(() => {})
  }

  // Toast with an Undo that reverses the change (backend /undo)
  const undoable = (message, id) => toast(message, {
    action: {
      label: 'Undo',
      onClick: async () => {
        try { await undoPosition(id); afterChange(); toast('Undone') }
        catch (e) { toast(apiError(e, "Couldn't undo that."), { tone: 'error' }) }
      },
    },
  })

  const askDelete = p => setConfirm({
    title: 'Delete this call?',
    body: <>Only for a call entered by mistake. The {p.ticker} {strike(p.strike)} call ({plural(p.contracts, 'contract')}) is removed and its contracts are free again. This can't be undone.</>,
    confirmLabel: 'Delete call', danger: true,
    run: async () => { await deletePosition(p.id); afterChange(); toast(`${p.ticker} ${strike(p.strike)} call deleted`) },
  })
  const askUndo = p => {
    const rolled = rolledIds.has(p.id)
    const what = p.status === 'ASSIGNED'
      ? <>Your {(p.contracts * 100).toLocaleString()} {p.ticker} shares go back into your holding and the call returns to {p.expiry < new Date().toISOString().slice(0, 10) ? 'expired' : 'open'}.</>
      : rolled ? <>The new call from this roll is removed and this {strike(p.strike)} call is open again.</>
        : <>The {p.ticker} {strike(p.strike)} call is open again and its buyback cost is cleared.</>
    setConfirm({
      title: p.status === 'ASSIGNED' ? 'Undo the assignment?' : rolled ? 'Undo the roll?' : 'Reopen this call?',
      body: what, confirmLabel: 'Undo',
      run: async () => {
        const r = await undoPosition(p.id)
        afterChange()
        toast(p.status === 'ASSIGNED' ? `Assignment undone: ${r.data.shares_returned.toLocaleString()} shares returned` : rolled ? 'Roll undone' : 'Call reopened')
      },
    })
  }
  const askCalledAway = p => setConfirm({
    title: 'Were your shares called away?',
    body: <>Records that the {p.ticker} {strike(p.strike)} call was exercised: {(p.contracts * 100).toLocaleString()} shares leave your holding and you keep the full premium.</>,
    confirmLabel: 'Record assignment',
    run: async () => { await assignPosition(p.id); afterChange(); undoable(`Assignment recorded: ${(p.contracts * 100).toLocaleString()} ${p.ticker} shares removed`, p.id) },
  })
  // ConfirmDialog shows errors thrown by run()
  const runConfirm = async () => {
    try { await confirm.run() } catch (e) { throw new Error(apiError(e, 'Could not save that. Is the API running?'), { cause: e }) }
  }

  // Ready to buy back and going against you get the full card (there's something
  // to do); the rest are one line until opened. Soonest expiry first in each group.
  const avgCostOf = p => tickers.find(t => t.ticker === p.ticker)?.avg_cost
  const groupOf = p => {
    const e = evals?.[p.id]
    if (!e) return 'hold'
    if (againstYou(p, e, avgCostOf(p))) return 'against'
    return e.should_buy_back ? 'ready' : 'hold'
  }
  const byExpiry = (a, b) => a.expiry.localeCompare(b.expiry) || a.ticker.localeCompare(b.ticker)
  const groups = [
    { key: 'ready',   title: 'Ready to buy back' },
    { key: 'against', title: 'Going against you' },
    { key: 'hold',    title: evals ? 'Holding' : 'Open calls' },
  ].map(g => ({ ...g, calls: open.filter(p => groupOf(p) === g.key).sort(byExpiry) })).filter(g => g.calls.length > 0)

  const card = (p, onCollapse) => (
    <PositionCard key={p.id} p={p} showTicker={showTicker} ev={evals?.[p.id]} checking={checking} failed={prices.failed}
      avgCost={avgCostOf(p)} onCollapse={onCollapse}
      onClose={setClosingPos} onRoll={setRollingPos} onEdit={setEditingPos} onDelete={askDelete} />
  )

  return (
    <div className="page">
      {closingPos && <CloseModal position={closingPos} evaluation={evals?.[closingPos.id]} onCancel={() => setClosingPos(null)}
        onDone={how => {
          const p = closingPos
          afterChange()
          undoable(how === 'assigned'
            ? `Assignment recorded: ${(p.contracts * 100).toLocaleString()} ${p.ticker} shares removed`
            : `${p.ticker} ${strike(p.strike)} call closed`, p.id)
        }} />}
      {rollingPos && <RollModal position={rollingPos} evaluation={evals?.[rollingPos.id]} onCancel={() => setRollingPos(null)}
        onDone={() => { const p = rollingPos; afterChange(); undoable(`${p.ticker} call rolled`, p.id) }} />}
      {editingPos && <EditTradeModal position={editingPos} onCancel={() => setEditingPos(null)}
        onDone={() => { afterChange(); toast('Trade updated') }} />}
      {adding && <AddCallModal tickers={tickers} defaultTicker={selected} onCancel={() => setAdding(false)}
        onDone={t => { setAdding(false); if (t !== selected) selectTicker(t); setTab('OPEN'); afterChange(); toast(`${t} call added`) }} />}
      {confirm && <ConfirmDialog title={confirm.title} confirmLabel={confirm.confirmLabel} danger={confirm.danger}
        onConfirm={runConfirm} onCancel={() => setConfirm(null)}>{confirm.body}</ConfirmDialog>}

      <PageHeader
        title="Positions"
        actions={!fetched.failed && tickers.length > 0 && <>
          {open.length > 0 && <>
            <button type="button" className="icon-btn md:hidden" onClick={() => setRefreshKey(k => k + 1)} disabled={checking} aria-label="Refresh prices">
              {checking ? <Spinner /> : <RefreshCw size={19} strokeWidth={1.9} />}
            </button>
            <button type="button" className="btn btn-secondary btn-sm hidden md:inline-flex" onClick={() => setRefreshKey(k => k + 1)} disabled={checking}>
              {checking ? <Spinner /> : <RefreshCw size={15} strokeWidth={2} />} Refresh prices
            </button>
          </>}
          <button type="button" className="icon-btn text-fg md:hidden" onClick={() => setAdding(true)} aria-label="Add a call">
            <Plus size={22} strokeWidth={2} />
          </button>
          <button type="button" className="btn btn-secondary btn-sm hidden md:inline-flex" onClick={() => setAdding(true)}>
            <Plus size={15} strokeWidth={2.2} /> Add a call
          </button>
        </>}
      />

      {error && <p role="alert" className="mb-4 flex items-start gap-2 text-15 text-loss"><Dot tone="loss" className="mt-2" />{error}</p>}

      {fetched.failed && !loading ? <ServerDown onRetry={reload} /> : <>
      <AssignmentReview items={review} onChanged={(kind, p) => {
        afterChange()
        if (kind === 'assigned') undoable(`Assignment recorded: ${(p.contracts * 100).toLocaleString()} ${p.ticker} shares removed`, p.id)
        else toast(`${p.ticker} ${strike(p.strike)} call marked as not assigned`)
      }} />

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <Segmented large className="md:w-[300px]" label="Open or finished calls" value={tab} onChange={setTab}
          options={[{ value: 'OPEN', label: `Open${loading ? '' : ` · ${open.length}`}` }, { value: 'CLOSED', label: `History${loading ? '' : ` · ${closed.length}`}` }]} />
        {tickers.length > 1 && (
          <StockChips label="Which stocks" all tickers={tickers} value={scope === 'all' ? null : selected}
            onChange={t => { if (t == null) setScope('all'); else { selectTicker(t); setScope('stock') } }} />
        )}
      </div>

      <div className="mt-5">
        {loading ? (
          <PositionsSkeleton />
        ) : tab === 'OPEN' ? (
          tickers.length === 0 ? (
            <EmptyState icon={Layers} title="Add a stock first" action={<AddStockLink />}>
              Covered calls are sold against shares you own. Add your stocks, then scan for a call or record one you sold with your broker.
            </EmptyState>
          ) : open.length === 0 ? (
            <EmptyState icon={Layers} title={`No open calls${scope === 'stock' && selected ? ` on ${selected}` : ''}`}
              action={<Link to="/scanner" className="btn btn-primary"><ScanLine size={16} strokeWidth={2} /> Go to Scanner</Link>}>
              Run a scan to find one to sell, or add one you sold with your broker.
            </EmptyState>
          ) : (
            <>
              {evals && <PriceStamp meta={prices.meta} />}
              {evals && readyCount === 0 && (
                <p className="mt-3 text-15 text-fg-2">
                  {expireCount > 0
                    ? <>Nothing to buy back. {expireCount === open.length ? (expireCount === 1 ? 'It' : 'They') : plural(expireCount, 'call')} can be left to expire.</>
                    : <>Nothing to do right now. Keep holding {open.length === 1 ? 'it' : `all ${open.length}`}.</>}
                </p>
              )}
              {groups.map(g => (
                <section key={g.key} aria-label={g.title} className="mt-7 first:mt-5">
                  <h2 className="mb-3 text-17 font-semibold">{g.title} <span className="font-medium text-muted">{g.calls.length}</span></h2>
                  {g.key !== 'hold' ? (
                    <div className="grid gap-3 md:grid-cols-2">{g.calls.map(p => card(p))}</div>
                  ) : (
                    <>
                      {g.calls.some(p => expanded.has(p.id)) && (
                        <div className="mb-3 grid gap-3 md:grid-cols-2">
                          {g.calls.filter(p => expanded.has(p.id)).map(p => card(p, () => toggleExpanded(p.id)))}
                        </div>
                      )}
                      <ul>
                        {g.calls.filter(p => !expanded.has(p.id)).map(p => (
                          <CallRow key={p.id} p={p} showTicker={showTicker} ev={evals?.[p.id]} checking={checking} failed={prices.failed}
                            onExpand={() => toggleExpanded(p.id)} />
                        ))}
                      </ul>
                    </>
                  )}
                </section>
              ))}
              {evals && <p className="mt-6 text-12 text-muted">Kept is the share of the premium you'd keep if you bought the call back now. The mark on each bar is your target.</p>}
            </>
          )
        ) : closed.length === 0 ? (
          <EmptyState icon={Layers} title="No finished calls yet">Calls show up here once they're bought back, expire or are assigned.</EmptyState>
        ) : (
          <>
            <p className="text-13 text-muted">{scope === 'all' ? 'Every finished call, including stocks you no longer hold.' : `Finished calls on ${selected || 'this stock'}.`}</p>
            <ul className="mt-2">
              {closed.map(p => {
                const net = optionNet(p)
                const label = resultLabel(p, rolledIds)
                return (
                  <li key={p.id} className="flex items-center gap-3 border-b border-line py-3.5">
                    <div className="min-w-0 flex-1">
                      <div className="text-15 font-semibold">{p.ticker} {strike(p.strike)} × {p.contracts}</div>
                      <div className="flex items-center gap-1.5 text-13 text-muted">
                        {label === 'Assigned' && <Dot tone="amber" />}{label === 'Assigned' ? 'Called away' : label} · {fmtDate(p.closed_at)} · {p.allocation_type}
                      </div>
                    </div>
                    <div className="text-right">
                      {net == null
                        ? <button type="button" className="link text-15 text-amber" onClick={() => setEditingPos(p)}>Add cost</button>
                        : <div className="text-15 font-semibold" style={{ color: net < 0 ? 'var(--loss)' : undefined }}>{signedMoney(net)}</div>}
                      <div className="text-13 text-muted">collected {money(p.premium_total)}{p.close_cost > 0 ? ` · paid ${money(p.close_cost)}` : ''}</div>
                    </div>
                    <ActionMenu label={`Actions for the ${p.ticker} ${strike(p.strike)} call`} className="-mr-2" items={[
                      { label: 'Edit', icon: Pencil, onClick: () => setEditingPos(p) },
                      p.status === 'EXPIRED'
                        ? { label: 'Shares were called away', icon: UserCheck, onClick: () => askCalledAway(p) }
                        : { label: rolledIds.has(p.id) ? 'Undo roll' : p.status === 'ASSIGNED' ? 'Undo assignment' : 'Reopen (undo close)', icon: Undo2, onClick: () => askUndo(p) },
                    ]} />
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </div>
      </>}
    </div>
  )
}
