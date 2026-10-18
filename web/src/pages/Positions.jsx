// src/pages/Positions.jsx
// One place for your covered calls: what's open, whether to buy back, and history. A call
// "needs a decision" only when its stock is near or above the strike (your shares may be
// sold); the rest are on track.
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  apiError, assignPosition, deletePosition, getAllPositions, getAssignmentReview, undoPosition,
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
import { forgetPriceChecks, usePriceCheck } from '../lib/usePriceCheck'
import { forgetRolls, useRolls } from '../lib/useRolls'
import ActionMenu from '../components/ActionMenu'
import AssignmentReview from '../components/AssignmentReview'
import CloseModal from '../components/dialogs/CloseModal'
import RollModal from '../components/dialogs/RollModal'
import RollOptionsModal from '../components/dialogs/RollOptionsModal'
import EditTradeModal from '../components/dialogs/EditTradeModal'
import AddCallModal from '../components/dialogs/AddCallModal'
import ConfirmDialog from '../components/dialogs/ConfirmDialog'
import Modal, { DialogHead } from '../components/dialogs/Modal'
import PriceStamp, { priceAsOf } from '../components/PriceStamp'
import InfoTip from '../components/InfoTip'
import { Dot, KeptBar, Moon, Segmented, Spinner } from '../components/ui'
import { fmtDate, daysUntil, marketToday, money, plural, signedMoney, strike } from '../lib/format'
import { DECISION_PCT, keptPct, needsDecision, optionNet, resultLabel } from '../lib/pnl'
import { TERMS } from '../lib/terms'

const SCOPE_KEY = 'positions_scope'
const loadScope = () => { try { return localStorage.getItem(SCOPE_KEY) === 'stock' ? 'stock' : 'all' } catch { return 'all' } }
const saveScope = s => { try { localStorage.setItem(SCOPE_KEY, s) } catch { /* storage unavailable */ } }

const callName = (p, showTicker) => `${showTicker ? `${p.ticker} ` : ''}${strike(p.strike)} call`
const daysLeft = p => {
  const d = daysUntil(p.expiry)
  return d === 0 ? 'expires today' : d > 0 ? `${plural(d, 'day')} left` : 'expired'
}

// Copy the limit price, ready to paste into the order at your broker
function CopyPrice({ price }) {
  const toast = useToast()
  const copy = async () => {
    try { await navigator.clipboard.writeText(price.toFixed(2)); toast(`Copied ${money(price)}`) }
    catch { toast(`Limit price: ${money(price)}`) }
  }
  return (
    <button type="button" className="icon-btn icon-btn-sm -mr-2 shrink-0" onClick={copy} aria-label={`Copy the limit price, ${money(price)}`}>
      <Copy size={16} strokeWidth={2} />
    </button>
  )
}

// The order to place at your broker for a call that's ready to buy back. CovCall
// only records trades, so this spells out what to enter there.
function OrderTicket({ p, ev }) {
  return (
    <div className="mt-4 rounded-sm bg-inset px-4 py-3">
      <div className="text-12 text-muted">Order to place at your broker</div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-1.5 text-15 font-semibold">
          <span className="inline-flex items-center gap-1">Buy to close <InfoTip text={TERMS.buyToClose} size={12} /></span>
          <span aria-hidden="true" className="text-muted">·</span><span>{plural(p.contracts, 'contract')}</span>
          <span aria-hidden="true" className="text-muted">·</span><span>Limit {money(ev.buyback_price)}</span>
        </div>
        <CopyPrice price={ev.buyback_price} />
      </div>
      <p className="mt-1 text-13 text-fg-2">A limit order fills at the market price and never pays more than {money(ev.buyback_price)} a share. Once it fills, record it below.</p>
    </div>
  )
}

// The third choice when a call needs a decision: roll it later and higher, for a credit
function RollChoice({ p, onFindRoll }) {
  const { data, loading, error } = useRolls(p.id)
  const best = data?.rolls?.[0]
  return (
    <div className="rounded-sm bg-inset p-4">
      <div className="text-15 font-semibold">Roll it: later and higher</div>
      <div className="mt-1 text-13 text-fg-2">
        {loading ? <span className="inline-flex items-center gap-2 text-muted"><Spinner className="h-3.5 w-3.5" /> Looking for a roll…</span>
          : error || (best
            ? <>Swap it for the {fmtDate(best.expiry)} {strike(best.strike)} call and collect <span className="font-semibold text-accent">{money(best.net_total, 0)} more</span>.
                {best.strike > p.strike ? <> Your shares would sell at {strike(best.strike)} instead, if at all.</> : <> Same strike, more time.</>}</>
            : data?.note)}
      </div>
      {best && (
        <button type="button" className="btn btn-secondary btn-sm mt-3" onClick={() => onFindRoll(p)}>
          See {data.rolls.length === 1 ? 'it' : `${data.rolls.length} rolls`} <ChevronRight size={15} strokeWidth={2.2} />
        </button>
      )}
    </div>
  )
}

// In the money with less time value left than the coming dividend: the buyer may
// exercise the day before the ex-dividend date to collect it
function EarlyExercise({ p, e }) {
  return (
    <div className="mt-4 flex items-start gap-2 rounded-sm bg-inset p-4">
      <Dot tone="amber" className="mt-2" />
      <div>
        <div className="text-15 font-semibold">Likely to be exercised early, on {fmtDate(e.exercise_by)}</div>
        <p className="mt-1 text-13 text-fg-2">
          {p.ticker} goes ex-dividend on {fmtDate(e.ex_dividend_date)} and pays about {money(e.dividend)} a share. The call has {money(e.time_value)} of
          time value left, less than the dividend, so the buyer may exercise the day before to collect it. To keep your shares, buy back or roll by {fmtDate(e.exercise_by)}.
        </p>
      </div>
    </div>
  )
}

// The stock is near or above the strike, so your shares may be sold: the three choices in
// plain words, with the call money kept apart from the share sale (and its tax)
function Decision({ p, d, onFindRoll }) {
  const shares = d.shares.toLocaleString()
  return (
    <div className="mt-4">
      <p className="flex items-start gap-2 text-15 text-fg-2">
        <Dot tone={d.aboveStrike ? 'loss' : 'amber'} className="mt-2" />
        <span>
          <strong className="font-semibold text-fg">
            {p.ticker} is {money(d.stock)}, {d.aboveStrike ? `above your ${strike(p.strike)} strike.` : `${d.fromStrikePct.toFixed(1)}% below your ${strike(p.strike)} strike.`}
          </strong>{' '}
          {d.aboveStrike
            ? `If it stays there through ${fmtDate(p.expiry)}, your ${shares} shares are sold at ${strike(p.strike)}.`
            : `If it closes above ${strike(p.strike)} on ${fmtDate(p.expiry)}, your ${shares} shares are sold at ${strike(p.strike)}.`}
        </span>
      </p>
      <div className="mt-3 grid gap-2.5">
        <div className="rounded-sm bg-inset p-4">
          <div className="text-15 font-semibold">Keep your shares: buy the call back</div>
          <div className="mt-1 text-13 text-fg-2">
            {d.buybackCost != null
              ? <>Costs {money(d.buybackCost, 0)} now. On this call you'd be{' '}
                  <span className={`font-semibold ${d.buybackPL < 0 ? 'text-loss' : 'text-accent'}`}>{money(Math.abs(d.buybackPL), 0)} {d.buybackPL < 0 ? 'down' : 'up'}</span>{' '}
                  ({money(d.collected, 0)} in, {money(d.buybackCost, 0)} out).</>
              : 'No current price for the call right now. Check again while the market is open.'}
          </div>
        </div>
        <div className="rounded-sm bg-inset p-4">
          <div className="text-15 font-semibold">Let them be sold at {strike(p.strike)}</div>
          <div className="mt-1 text-13 text-fg-2">
            You keep the <span className="font-semibold text-accent">{money(d.collected, 0)}</span> from the call and sell {shares} shares for {money(d.saleTotal, 0)}.
            {d.shareGain == null ? ' Add what you paid for the shares (Home, the stock’s ⋯ menu) to see the gain.'
              : d.shareGain >= 0 ? ` You bought them at ${money(d.cost)}, so that's a taxable gain of about ${money(d.shareGain, 0)}.`
                : ` You bought them at ${money(d.cost)}, so that's a loss of about ${money(-d.shareGain, 0)} on the shares.`}
            {d.upsideGiven > 0 && ` The ${money(d.upsideGiven, 0)} rise above ${strike(p.strike)} goes to the buyer.`}
          </div>
        </div>
        <RollChoice p={p} onFindRoll={onFindRoll} />
      </div>
    </div>
  )
}

// "Record what I did" on a call that needs a decision: which of the three it was
function RecordChoice({ p, onPick, onCancel }) {
  const choices = [
    ['bought', 'I bought it back', 'You keep your shares.'],
    ['rolled', 'I rolled it', 'Bought it back and sold a later call.'],
    ['assigned', 'My shares were sold', `The call was exercised at ${strike(p.strike)}.`],
  ]
  return (
    <Modal onDismiss={onCancel} labelledBy="record-title" width={440}>
      <DialogHead id="record-title" title="What did you do?" onClose={onCancel}
        sub={`${p.ticker} ${strike(p.strike)} call · ${fmtDate(p.expiry)} · ${plural(p.contracts, 'contract')}`} />
      <div className="mt-5 flex flex-col gap-2.5">
        {choices.map(([how, title, detail]) => (
          <button key={how} type="button" className="flex w-full items-center gap-3 rounded-card bg-surface p-4 text-left ring-1 ring-edge" onClick={() => onPick(how)}>
            <span className="min-w-0 flex-1">
              <span className="block text-15 font-semibold">{title}</span>
              <span className="block text-13 text-muted">{detail}</span>
            </span>
            <ChevronRight size={16} strokeWidth={2} className="shrink-0 text-muted" aria-hidden="true" />
          </button>
        ))}
      </div>
    </Modal>
  )
}

// What the latest price check says about one call
function Status({ p, ev, checking, failed, avgCost, asOf, onFindRoll }) {
  const withFees = chargesCommission(useStrategy()) ? ' with fees' : ''
  if (!ev) {
    return (
      <p className="mt-4 flex items-center gap-2 text-13 text-muted">
        {checking ? <><Spinner className="h-3.5 w-3.5" /> Checking the price…</> : failed ? "Couldn't check prices." : 'No price data for this call.'}
      </p>
    )
  }
  const decision = needsDecision(p, ev, avgCost)
  if (decision) return <Decision p={p} d={decision} onFindRoll={onFindRoll} />
  if (!(ev.current_option_price > 0)) {
    return (
      <p className="mt-4 text-13 text-muted">
        {ev.old_trade_date
          ? <>No current price: it last traded on {fmtDate(ev.old_trade_date)}, when the stock was elsewhere. Check again once the market opens.</>
          : "Couldn't get a price for this call right now (common outside market hours). Check again while the market is open."}
      </p>
    )
  }

  const buy = ev.should_buy_back
  const expire = ev.action === 'let_expire'
  const evText = ev.event ? `${ev.event.kind === 'earnings' ? `${p.ticker} reports` : 'The Fed decides'} on ${fmtDate(ev.event.date)}` : null
  const below = ev.stock_price > 0 ? (1 - ev.stock_price / ev.strike) * 100 : null
  const target = ev.buyback_kept_pct
  return (
    <>
      <KeptBar className="mt-4" pct={ev.profit_capture_pct} target={target} event={!!ev.event} />
      <div className="relative mt-1 h-4 text-11 text-muted" aria-hidden="true">
        {target > 0 && <span className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${Math.min(Math.max(target, 12), 88)}%` }}>target {keptPct(target)}%</span>}
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-3">
        <div>
          <dt className="text-12 text-muted">Price now</dt>
          <dd className="mt-0.5 text-17 font-semibold">{money(ev.current_option_price)}</dd>
          {asOf && <dd className="text-12 text-muted">{asOf}</dd>}
        </div>
        <div>
          <dt className="text-12 text-muted">Target price</dt>
          <dd className="mt-0.5 text-17 font-semibold">{ev.buyback_price > 0 ? money(ev.buyback_price) : '—'}</dd>
          {target > 0 && <dd className="text-12 text-muted">{keptPct(target)}% kept</dd>}
        </div>
        <div>
          <dt className="text-12 text-muted">To buy back</dt>
          <dd className="mt-0.5 text-17 font-semibold">{money(ev.cost_to_close)}</dd>
          <dd className="text-12 text-muted">{withFees ? 'total, with fees' : 'in total'}</dd>
        </div>
      </dl>
      {(!buy || evText) && (
        <p className="mt-3 flex items-start gap-2 text-13 text-fg-2">
          {ev.event && <Dot tone="amber" className="mt-1.5" />}
          <span>
            {buy
              ? <>{evText}, before this call expires, so the target drops to {ev.target_pct}%.</>
              : expire
                ? <>Expires in {plural(ev.days_left, 'day')} with the stock {below.toFixed(0)}% under the strike. Buying back would cost {money(ev.cost_to_close)}{withFees} for little benefit, so you can let it expire.</>
                : <>Not at your target yet{evText ? <>. {evText} before expiry, so the target drops to {ev.target_pct}% then</> : ''}.</>}
          </span>
        </p>
      )}
      {buy && ev.buyback_price > 0 && <OrderTicket p={p} ev={ev} />}
    </>
  )
}

function PositionCard({ p, showTicker, ev, checking, failed, avgCost, asOf, onClose, onRoll, onRecord, onFindRoll, onEdit, onDelete, onCollapse }) {
  const buy = ev?.should_buy_back
  const decision = needsDecision(p, ev, avgCost) || ev?.early_exercise
  const priced = ev && ev.current_option_price > 0 && !decision
  return (
    <article aria-label={`${p.ticker} ${strike(p.strike)} call`} className="rounded-card border border-line bg-surface p-5">
      {/* The moon is lit by how much of the premium you'd keep buying back now */}
      <div className="flex items-center gap-3">
        {priced && <Moon pct={Math.max(0, keptPct(ev.profit_capture_pct))} size={40} />}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="font-display text-20 font-medium">{callName(p, showTicker)}</h3>
            {priced && <span className="text-20 font-semibold" style={{ color: buy || ev.action === 'let_expire' ? 'var(--accent)' : undefined }}>{keptPct(ev.profit_capture_pct)}%</span>}
          </div>
          <div className="mt-0.5 flex justify-between gap-3 text-13 text-muted">
            <span>{plural(p.contracts, 'contract')} · {fmtDate(p.expiry)} · {daysLeft(p)}</span>
            {priced && <span>kept</span>}
          </div>
        </div>
      </div>
      <div className="mt-1 text-13 text-muted">
        {p.rolled_from ? 'Rolled · ' : ''}sold at {money(p.entry_price)} · you collected {money(p.premium_total)}
      </div>

      {ev?.early_exercise && <EarlyExercise p={p} e={ev.early_exercise} />}
      <Status p={p} ev={ev} checking={checking} failed={failed} avgCost={avgCost} asOf={asOf} onFindRoll={onFindRoll} />

      {/* On the narrowest phones "I bought it back" takes its own row, above the rest */}
      <div className="mt-5 flex flex-wrap items-center gap-2.5">
        {decision ? (
          <button type="button" className="btn btn-secondary flex-1 px-4" onClick={() => onRecord(p)}>Record what I did</button>
        ) : <>
          <button type="button" className="btn btn-secondary flex-1 px-4" onClick={() => onRoll(p)}>I rolled it</button>
          <button type="button" className={`btn flex-[1.4] px-4 max-[360px]:order-first max-[360px]:basis-full ${buy ? 'btn-primary' : 'btn-secondary'}`} onClick={() => onClose(p)}>I bought it back</button>
        </>}
        <ActionMenu label={`More for the ${p.ticker} ${strike(p.strike)} call`} className="-mr-2" items={[
          onCollapse && { label: 'Show less', icon: ChevronRight, onClick: onCollapse },
          { label: 'Find a roll', icon: Repeat, onClick: () => onFindRoll(p) },
          { label: 'Edit fill or fees', icon: Pencil, onClick: () => onEdit(p) },
          // A rolled call is undone from History so the original call reopens
          !p.rolled_from && { label: 'Delete (entered by mistake)', icon: Trash2, danger: true, onClick: () => onDelete(p) },
        ]} />
      </div>
    </article>
  )
}

// One line for a call that's on track: how far the stock is under the strike, what happens
// if it stays there (or the price that locks in your target), and how much is earned so far
function CallRow({ p, showTicker, ev, checking, failed, onExpand }) {
  const priced = ev && ev.current_option_price > 0
  const expire = ev?.action === 'let_expire'
  const below = ev?.stock_price > 0 ? (1 - ev.stock_price / p.strike) * 100 : null
  const collected = p.premium_total - (p.open_fees || 0)
  const keep = !ev ? null
    : expire ? 'Can be left to expire'
      : priced && ev.profit_capture_pct >= 50 && ev.buyback_price > 0 ? `Buy back at ${money(ev.buyback_price)} or less to lock in ${keptPct(ev.buyback_kept_pct)}%`
        : `If it stays below, you keep all ${money(collected, 0)}`
  return (
    <li className="border-b border-line last:border-b-0">
      <button type="button" className="flex w-full items-center gap-3 py-3.5 text-left" onClick={onExpand} aria-expanded="false"
        aria-label={`${callName(p, true)}, ${priced ? `${Math.max(0, keptPct(ev.profit_capture_pct))}% earned so far` : 'no current price'}. Show details`}>
        {priced ? <Moon pct={Math.max(0, keptPct(ev.profit_capture_pct))} size={28} /> : <span className="w-7 shrink-0" aria-hidden="true" />}
        <span className="min-w-0 flex-1">
          <span className="block text-15 font-semibold">{callName(p, showTicker)}</span>
          <span className="block text-13 text-muted">
            {fmtDate(p.expiry)}{below != null ? ` · ${p.ticker} ${below.toFixed(1)}% below the strike` : ` · ${plural(p.contracts, 'contract')}`}
          </span>
          {keep && <span className="block text-13 text-fg-2" style={{ color: expire ? 'var(--accent)' : undefined }}>{keep}</span>}
        </span>
        {priced ? (
          <span className="shrink-0 text-right">
            {/* A call a few cents above what you sold it for has earned nothing yet, not less */}
            <span className="block text-17 font-semibold">{Math.max(0, keptPct(ev.profit_capture_pct))}%</span>
            <span className="block text-12 text-muted">earned so far</span>
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
  const [closeHow, setCloseHow]   = useState('bought') // ...opened as a buyback, or as shares sold
  const [recording, setRecording] = useState(null)     // "What did you do?" for a call that needed a decision
  const [rollingPos, setRollingPos] = useState(null)   // Roll dialog
  const [rollPrefill, setRollPrefill] = useState(null) // the roll picked in Find a roll, if any
  const [rollsFor, setRollsFor]   = useState(null)     // Find a roll dialog
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

  // Prices are checked automatically whenever the open calls change, and every 5 minutes
  // while the market is open; "Refresh" re-checks. A check from Home is reused for a minute.
  const checkTicker = scope === 'all' ? null : selected
  const prices = usePriceCheck(loading ? [] : open.map(p => p.id), checkTicker)
  const checking = prices.checking
  const evals = prices.data ? Object.fromEntries(prices.data.positions.map(e => [e.id, e])) : null
  const pricesFailed = !!prices.error
  const readyCount = evals ? open.filter(p => evals[p.id]?.should_buy_back).length : 0
  const expireCount = evals ? open.filter(p => evals[p.id]?.action === 'let_expire').length : 0

  // After any change to a call: reload trades and the portfolio (contracts in use, shares)
  const afterChange = () => {
    setClosingPos(null); setRollingPos(null); setRollPrefill(null); setEditingPos(null); setConfirm(null); setError(null)
    forgetPriceChecks()
    forgetRolls()
    prices.refresh()
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
    body: <>Only for a call entered by mistake. The {p.ticker} {strike(p.strike)} call ({plural(p.contracts, 'contract')}) is removed and those {(p.contracts * 100).toLocaleString()} shares are no longer covered. This can't be undone.</>,
    confirmLabel: 'Delete call', danger: true,
    run: async () => { await deletePosition(p.id); afterChange(); toast(`${p.ticker} ${strike(p.strike)} call deleted`) },
  })
  const askUndo = p => {
    const rolled = rolledIds.has(p.id)
    const what = p.status === 'ASSIGNED'
      ? <>Your {(p.contracts * 100).toLocaleString()} {p.ticker} shares go back into your holding and the call returns to {p.expiry < marketToday() ? 'expired' : 'open'}.</>
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
    title: 'Were your shares sold?',
    body: <>Records that the {p.ticker} {strike(p.strike)} call was exercised: {(p.contracts * 100).toLocaleString()} shares leave your holding and you keep the full premium.</>,
    confirmLabel: 'Record assignment',
    run: async () => { await assignPosition(p.id); afterChange(); undoable(`Assignment recorded: ${(p.contracts * 100).toLocaleString()} ${p.ticker} shares removed`, p.id) },
  })
  // ConfirmDialog shows errors thrown by run()
  const runConfirm = async () => {
    try { await confirm.run() } catch (e) { throw new Error(apiError(e, 'Could not save that. Is the API running?'), { cause: e }) }
  }

  // Needs a decision and ready to buy back get the full card (there's something to do);
  // the rest are one line until opened. Soonest expiry first in each group.
  const avgCostOf = p => tickers.find(t => t.ticker === p.ticker)?.avg_cost
  const groupOf = p => {
    const e = evals?.[p.id]
    if (!e) return 'hold'
    if (e.early_exercise || needsDecision(p, e, avgCostOf(p))) return 'decide'
    return e.should_buy_back ? 'ready' : 'hold'
  }
  const byExpiry = (a, b) => a.expiry.localeCompare(b.expiry) || a.ticker.localeCompare(b.ticker)
  const groups = [
    { key: 'decide',  title: 'Needs a decision' },
    { key: 'ready',   title: 'Ready to buy back' },
    { key: 'hold',    title: evals ? 'On track' : 'Open calls' },
  ].map(g => ({ ...g, calls: open.filter(p => groupOf(p) === g.key).sort(byExpiry) })).filter(g => g.calls.length > 0)

  const card = (p, onCollapse) => (
    <PositionCard key={p.id} p={p} showTicker={showTicker} ev={evals?.[p.id]} checking={checking} failed={pricesFailed}
      avgCost={avgCostOf(p)} asOf={priceAsOf(prices.data)} onCollapse={onCollapse}
      onClose={p => { setCloseHow('bought'); setClosingPos(p) }} onRoll={p => { setRollPrefill(null); setRollingPos(p) }} onRecord={setRecording} onFindRoll={setRollsFor}
      onEdit={setEditingPos} onDelete={askDelete} />
  )

  return (
    <div className="page">
      {recording && <RecordChoice p={recording} onCancel={() => setRecording(null)}
        onPick={how => {
          const p = recording
          setRecording(null)
          if (how === 'rolled') { setRollPrefill(null); setRollingPos(p) } else { setCloseHow(how); setClosingPos(p) }
        }} />}
      {closingPos && <CloseModal position={closingPos} how={closeHow} evaluation={evals?.[closingPos.id]} onCancel={() => setClosingPos(null)}
        onDone={how => {
          const p = closingPos
          afterChange()
          undoable(how === 'assigned'
            ? `Assignment recorded: ${(p.contracts * 100).toLocaleString()} ${p.ticker} shares removed`
            : `${p.ticker} ${strike(p.strike)} call closed`, p.id)
        }} />}
      {rollsFor && <RollOptionsModal position={rollsFor} onCancel={() => setRollsFor(null)}
        onUse={(roll, buyback) => {
          const p = rollsFor
          setRollsFor(null)
          setRollPrefill({ expiry: roll.expiry, strike: roll.strike, price: roll.price, buyback })
          setRollingPos(p)
        }} />}
      {rollingPos && <RollModal position={rollingPos} evaluation={evals?.[rollingPos.id]} prefill={rollPrefill}
        onCancel={() => { setRollingPos(null); setRollPrefill(null) }}
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
            <button type="button" className="icon-btn md:hidden" onClick={prices.refresh} disabled={checking} aria-label="Refresh prices">
              {checking ? <Spinner /> : <RefreshCw size={19} strokeWidth={1.9} />}
            </button>
            <button type="button" className="btn btn-secondary btn-sm hidden md:inline-flex" onClick={prices.refresh} disabled={checking}>
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

      {(error || prices.error) && <p role="alert" className="mb-4 flex items-start gap-2 text-15 text-loss"><Dot tone="loss" className="mt-2" />{error || prices.error}</p>}

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
              {evals && <PriceStamp meta={prices.data} />}
              {/* "Nothing to do" only when no call needs a decision either */}
              {evals && readyCount === 0 && !groups.some(g => g.key === 'decide') && (
                <p className="mt-3 text-15 text-fg-2">
                  {expireCount > 0
                    ? <>Nothing to buy back. {expireCount === open.length ? (expireCount === 1 ? 'It' : 'They') : plural(expireCount, 'call')} can be left to expire.</>
                    : <>Nothing to do right now. Keep holding {open.length === 1 ? 'it' : `all ${open.length}`}.</>}
                </p>
              )}
              {groups.map(g => (
                <section key={g.key} aria-label={g.title} className="mt-7 first:mt-5">
                  <h2 className="mb-3 font-display text-22 font-medium">{g.title} <span className="font-sans text-15 font-medium text-muted">{g.calls.length}</span></h2>
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
                          <CallRow key={p.id} p={p} showTicker={showTicker} ev={evals?.[p.id]} checking={checking} failed={pricesFailed}
                            onExpand={() => toggleExpanded(p.id)} />
                        ))}
                      </ul>
                    </>
                  )}
                </section>
              ))}
              {groups.some(g => g.key === 'decide') && (
                <p className="mt-6 text-12 text-muted">"Needs a decision" only when the stock is within {DECISION_PCT}% of your strike or above it. A call costing a few cents more than you sold it for is normal.</p>
              )}
              {/* The bars only show on full cards */}
              {evals && open.some(p => groupOf(p) === 'ready' || (groupOf(p) === 'hold' && expanded.has(p.id))) && (
                <p className="mt-2 text-12 text-muted">Kept is the share of the premium you'd keep if you bought the call back now. The mark on each bar is your target.</p>
              )}
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
                        {label === 'Assigned' && <Dot tone="amber" />}{label === 'Assigned' ? `Shares sold at ${strike(p.strike)}` : label} · {fmtDate(p.closed_at)}
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
                        ? { label: 'My shares were sold', icon: UserCheck, onClick: () => askCalledAway(p) }
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
