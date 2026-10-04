// src/pages/Positions.jsx
// One place for your covered calls: what's open, whether to buy back, and history.
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  apiError, assignPosition, deletePosition, getAllPositions, getAssignmentReview, getManagement, undoPosition,
} from '../api/client'
import { useTicker } from '../context/TickerContext'
import { useToast } from '../context/ToastContext'
import {
  AlertTriangle, Hourglass, Layers, RefreshCw, CheckCircle2, Clock3, ScanLine, HelpCircle, Repeat, Plus, Pencil, Trash2, Undo2, UserCheck, Copy,
} from 'lucide-react'
import PageHeader from '../components/PageHeader'
import InfoTip from '../components/InfoTip'
import ServerDown from '../components/ServerDown'
import EmptyState, { AddStockLink } from '../components/EmptyState'
import { PositionsSkeleton } from '../components/Skeleton'
import { useStrategy, chargesCommission } from '../lib/useStrategy'
import ActionMenu from '../components/ActionMenu'
import AssignmentReview from '../components/AssignmentReview'
import CloseModal from '../components/dialogs/CloseModal'
import RollModal from '../components/dialogs/RollModal'
import EditTradeModal from '../components/dialogs/EditTradeModal'
import AddCallModal from '../components/dialogs/AddCallModal'
import ConfirmDialog from '../components/dialogs/ConfirmDialog'
import PriceStamp from '../components/PriceStamp'
import { TERMS } from '../lib/terms'
import { fmtDate, daysUntil, money, plural } from '../lib/format'
import { optionNet, resultLabel, totalFees } from '../lib/pnl'

const SCOPE_KEY = 'positions_scope'
const loadScope = () => { try { return localStorage.getItem(SCOPE_KEY) === 'stock' ? 'stock' : 'all' } catch { return 'all' } }
const saveScope = s => { try { localStorage.setItem(SCOPE_KEY, s) } catch { /* storage unavailable */ } }

// Copy the buy-back price, ready to paste into a limit order at your broker
function CopyPrice({ price }) {
  const toast = useToast()
  const copy = async () => {
    try { await navigator.clipboard.writeText(price.toFixed(2)); toast(`Copied ${money(price)}`) }
    catch { toast(`Buy-back price: ${money(price)}`) }
  }
  return (
    <button type="button" className="btn-secondary copy-btn" onClick={copy} aria-label={`Copy the buy-back price, ${money(price)}`}>
      <Copy size={14} strokeWidth={2} /> Copy
    </button>
  )
}

function StatusPanel({ evaluation, checking, failed }) {
  const withFees = chargesCommission(useStrategy()) ? ' with fees' : ''
  if (!evaluation) {
    if (checking) return <div className="hint" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span className="spinner" style={{ width: 14, height: 14 }} /> Checking the price…</div>
    return <div className="hint">{failed ? "Couldn't check prices." : 'No price data for this call.'}</div>
  }
  if (!(evaluation.current_option_price > 0)) {
    return (
      <div>
        <span className="badge" style={{ fontSize: 13, background: 'rgba(255,255,255,0.06)', color: 'var(--text-dim)', border: '1px solid var(--border)' }}>
          <HelpCircle size={14} strokeWidth={2} /> Price unavailable
        </span>
        <div className="hint" style={{ marginTop: 8 }}>
          {evaluation.old_trade_date
            ? <>It last traded on {fmtDate(evaluation.old_trade_date)}, when the stock was at a different price, so that's no guide to what it costs now. Check again once the market opens.</>
            : "Couldn't get a price for this call right now (common outside market hours). Check again while the market is open."}
        </div>
      </div>
    )
  }
  const kept = Math.max(0, Math.min(evaluation.profit_capture_pct, 100))
  const buy = evaluation.should_buy_back
  const expire = evaluation.action === 'let_expire'
  const ev = evaluation.event
  const evText = ev ? `${ev.kind === 'earnings' ? 'Earnings' : "The Fed's rate decision"} on ${fmtDate(ev.date)}` : null
  // How far the stock is under the strike, as a share of the strike
  const below = evaluation.stock_price > 0 ? (1 - evaluation.stock_price / evaluation.strike) * 100 : null
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 12 }}>
        {buy
          ? <span className="badge badge-green" style={{ fontSize: 13 }}><CheckCircle2 size={14} strokeWidth={2} /> Buy back now</span>
          : expire
            ? <span className="badge badge-blue" style={{ fontSize: 13 }}><Hourglass size={14} strokeWidth={2} /> Let it expire</span>
            : <span className="badge badge-amber" style={{ fontSize: 13 }}><Clock3 size={14} strokeWidth={2} /> Keep holding</span>}
        <span className="fact-label" style={{ margin: 0 }}>
          Premium kept <InfoTip text={TERMS.profit} size={12} />
          <strong className="mono" style={{ color: buy || expire ? 'var(--green)' : 'var(--text)', marginLeft: 4 }}>{evaluation.profit_capture_pct.toFixed(0)}%</strong>
        </span>
      </div>
      <div className="kept-bar">
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${kept}%`, background: buy || expire ? 'var(--green)' : 'var(--accent)' }} />
        </div>
        {evaluation.buyback_kept_pct > 0 && (
          <span className="kept-mark" style={{ left: `${Math.min(evaluation.buyback_kept_pct, 100)}%`, background: ev ? 'var(--amber)' : 'var(--text)' }}
            title={`Target: ${evaluation.buyback_kept_pct.toFixed(1)}% kept`} />
        )}
      </div>
      {evaluation.buyback_price > 0 && (
        <div className="buyback-box">
          <div>
            <div className="hint" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>Limit order: buy back at <InfoTip text={TERMS.buybackPrice} size={12} /></div>
            <div>
              <strong className="mono" style={{ fontSize: 18 }}>{money(evaluation.buyback_price)}</strong>
              <span className="dim"> or less · {evaluation.buyback_kept_pct.toFixed(1)}% kept · now <span className="mono">{money(evaluation.current_option_price)}</span></span>
            </div>
          </div>
          <CopyPrice price={evaluation.buyback_price} />
        </div>
      )}
      <div className="hint" style={{ marginTop: 8 }}>
        {buy && ev
          ? <>{evText} comes before this call expires, so the earlier {evaluation.target_pct}% target applies. Buying back now costs about <strong style={{ color: 'var(--text)' }}>{money(evaluation.cost_to_close)}</strong>{withFees} and avoids holding through the jump.</>
          : buy
          ? <>Buying back now costs about <strong style={{ color: 'var(--text)' }}>{money(evaluation.cost_to_close)}</strong>{withFees} and locks in the gain.</>
          : expire
            ? <>Expires in {plural(evaluation.days_left, 'day')} with the stock {below.toFixed(0)}% below the strike. Buying back would cost {money(evaluation.cost_to_close)}{withFees} for little benefit, so you can let it expire and keep that.</>
            : <>It would cost {money(evaluation.cost_to_close)}{withFees} to buy back today. Not worth it yet{ev ? <>; {evText.charAt(0).toLowerCase() + evText.slice(1)} comes before expiry, so you'll be told to buy back at {evaluation.target_pct}%</> : ''}.</>}
      </div>
    </div>
  )
}

function PositionCard({ p, showTicker, evaluation, checking, failed, onClose, onRoll, onEdit, onDelete }) {
  const days = daysUntil(p.expiry)
  const buy = evaluation?.should_buy_back
  return (
    <div className="card" style={{ borderColor: buy ? 'rgba(62,224,166,0.35)' : undefined }}>
      <div className="grid-split">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
            {showTicker && <span className="ticker-tag">{p.ticker}</span>}
            <span className={`badge badge-${p.allocation_type === 'Income' ? 'accent' : 'violet'}`}>{p.allocation_type}</span>
            {p.rolled_from && <span className="badge badge-blue">Rolled</span>}
            <span className="hint">Opened {fmtDate(p.opened_at)}</span>
          </div>
          <div style={{ fontSize: 19, fontWeight: 700, marginBottom: 4 }}>
            {money(p.strike)} call <span className="muted" style={{ fontWeight: 500, fontSize: 15 }}>
              · expires {fmtDate(p.expiry)}{days === 0 ? ' (today)' : days != null && days > 0 ? ` (${plural(days, 'day')})` : ''}
            </span>
          </div>
          <div style={{ fontSize: 14, color: 'var(--text-dim)' }}>
            {plural(p.contracts, 'contract')} · sold at {money(p.entry_price)}/share · collected{' '}
            <strong style={{ color: 'var(--green)' }}>{money(p.premium_total)}</strong>
            {p.open_fees > 0 && <span className="muted"> ({money(p.open_fees)} fees)</span>}
          </div>
        </div>
        <div>
          <StatusPanel evaluation={evaluation} checking={checking} failed={failed} />
          <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8 }}>
            <button className="btn-secondary" style={{ padding: '7px 14px', fontSize: 13 }} onClick={() => onRoll(p)}>
              <Repeat size={14} strokeWidth={2} /> Roll
            </button>
            <button className={buy ? 'btn-primary' : 'btn-secondary'} style={{ padding: '7px 14px', fontSize: 13 }} onClick={() => onClose(p)}>
              {buy ? 'Buy back & close' : 'Close'}
            </button>
            <ActionMenu label={`More actions for the ${money(p.strike)} ${p.ticker} call`} items={[
              { label: 'Edit fill or fees', icon: Pencil, onClick: () => onEdit(p) },
              // A rolled call is undone from History so the original call reopens
              !p.rolled_from && { label: 'Delete (entered by mistake)', icon: Trash2, danger: true, onClick: () => onDelete(p) },
            ]} />
          </div>
        </div>
      </div>
    </div>
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
  const finished  = positions.filter(p => p.status !== 'OPEN')
  const closed    = finished.filter(inScope)
    .slice().sort((a, b) => (b.closed_at || '').localeCompare(a.closed_at || '') || b.id - a.id)
  const rolledIds = new Set(positions.filter(p => p.rolled_from).map(p => p.rolled_from))

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
    body: <>Only for a call entered by mistake. The {money(p.strike)} {p.ticker} call ({plural(p.contracts, 'contract')}) is removed and its contracts are free again. This can't be undone.</>,
    confirmLabel: 'Delete call', danger: true,
    run: async () => { await deletePosition(p.id); afterChange(); toast(`${p.ticker} ${money(p.strike)} call deleted`) },
  })
  const askUndo = p => {
    const rolled = rolledIds.has(p.id)
    const what = p.status === 'ASSIGNED'
      ? <>Your {(p.contracts * 100).toLocaleString()} {p.ticker} shares go back into your holding and the call returns to {p.expiry < new Date().toISOString().slice(0, 10) ? 'expired' : 'open'}.</>
      : rolled ? <>The new call from this roll is removed and this {money(p.strike)} call is open again.</>
        : <>The {money(p.strike)} {p.ticker} call is open again and its buyback cost is cleared.</>
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
    body: <>Records that the {money(p.strike)} {p.ticker} call was exercised: {(p.contracts * 100).toLocaleString()} shares leave your holding and you keep the full premium.</>,
    confirmLabel: 'Record assignment',
    run: async () => { await assignPosition(p.id); afterChange(); undoable(`Assignment recorded: ${(p.contracts * 100).toLocaleString()} ${p.ticker} shares removed`, p.id) },
  })
  // ConfirmDialog shows errors thrown by run()
  const runConfirm = async () => {
    try { await confirm.run() } catch (e) { throw new Error(apiError(e, 'Could not save that. Is the API running?'), { cause: e }) }
  }

  const sortedOpen = open.slice().sort((a, b) =>
    (evals?.[b.id]?.should_buy_back ? 1 : 0) - (evals?.[a.id]?.should_buy_back ? 1 : 0)
    || a.expiry.localeCompare(b.expiry) || a.ticker.localeCompare(b.ticker))

  return (
    <div className="fade-up">
      {closingPos && <CloseModal position={closingPos} evaluation={evals?.[closingPos.id]} onCancel={() => setClosingPos(null)}
        onDone={how => {
          const p = closingPos
          afterChange()
          undoable(how === 'assigned'
            ? `Assignment recorded: ${(p.contracts * 100).toLocaleString()} ${p.ticker} shares removed`
            : `${p.ticker} ${money(p.strike)} call closed`, p.id)
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
        showTicker={scope === 'stock'}
        subtitle={scope === 'all' ? 'Your covered calls on every stock and what to do with each one.' : `Your covered calls on ${selected || 'this stock'} and what to do with each one.`}
        actions={!fetched.failed && tickers.length > 0 && <>
          <button className="btn-secondary" onClick={() => setAdding(true)}><Plus size={15} strokeWidth={2} /> Add a call</button>
          {open.length > 0 && (
            <button className="btn-secondary" onClick={() => setRefreshKey(k => k + 1)} disabled={checking} title="Check the latest option prices again">
              {checking ? <><span className="spinner" /> Checking…</> : <><RefreshCw size={15} strokeWidth={2} /> Refresh prices</>}
            </button>
          )}
        </>}
      />

      {error && (
        <div className="callout callout-red" style={{ marginBottom: 20 }}>
          <AlertTriangle size={18} strokeWidth={1.75} /> {error}
        </div>
      )}

      {fetched.failed && !loading ? <ServerDown onRetry={reload} /> : <>
      <AssignmentReview items={review} onChanged={(kind, p) => {
        afterChange()
        if (kind === 'assigned') undoable(`Assignment recorded: ${(p.contracts * 100).toLocaleString()} ${p.ticker} shares removed`, p.id)
        else toast(`${p.ticker} ${money(p.strike)} call marked as not assigned`)
      }} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <div className="tabs">
          <button className={`tab ${tab === 'OPEN' ? 'active' : ''}`} onClick={() => setTab('OPEN')}>Open{loading ? '' : ` (${open.length})`}</button>
          <button className={`tab ${tab === 'CLOSED' ? 'active' : ''}`} onClick={() => setTab('CLOSED')}>History{loading ? '' : ` (${closed.length})`}</button>
        </div>
        <div className="tabs" role="group" aria-label="Which stocks">
          <button className={`tab ${scope === 'all' ? 'active' : ''}`} onClick={() => setScope('all')}>All stocks</button>
          <button className={`tab ${scope === 'stock' ? 'active' : ''}`} onClick={() => setScope('stock')} disabled={!selected}>
            {selected || 'One stock'}
          </button>
        </div>
      </div>

      {loading ? (
        <PositionsSkeleton />
      ) : tab === 'OPEN' ? (
        tickers.length === 0 ? (
          <EmptyState icon={Layers} title="Add a stock first" action={<AddStockLink />}>
            Covered calls are sold against shares you own. Add your stocks, then scan for a call or record one you sold with your broker.
          </EmptyState>
        ) : open.length === 0 ? (
          <EmptyState icon={Layers} title={`No open calls${scope === 'stock' && selected ? ` on ${selected}` : ''}`}
            action={<Link to="/scanner" className="btn-primary" style={{ textDecoration: 'none' }}><ScanLine size={15} strokeWidth={2} /> Go to Scanner</Link>}>
            Run a scan to find one to sell, or add one you sold with your broker.
          </EmptyState>
        ) : (
          <>
            {evals && (
              <div className={`callout ${readyCount > 0 ? 'callout-green' : 'callout-amber'}`} style={{ marginBottom: 16 }}>
                {readyCount > 0
                  ? <><CheckCircle2 size={18} strokeWidth={1.75} /> {readyCount} of {plural(open.length, 'call')} {readyCount === 1 ? 'is' : 'are'} ready to buy back.</>
                  : expireCount > 0
                    ? <><Clock3 size={18} strokeWidth={1.75} /> Nothing to buy back. {expireCount === open.length ? (expireCount === 1 ? 'It' : 'They') : plural(expireCount, 'call')} can be left to expire.</>
                    : <><Clock3 size={18} strokeWidth={1.75} /> Nothing to do right now. Keep holding all {plural(open.length, 'call')}.</>}
              </div>
            )}
            {evals && <PriceStamp meta={prices.meta} style={{ marginTop: -6, marginBottom: 14 }} />}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {sortedOpen.map(p => (
                <PositionCard key={p.id} p={p} showTicker={scope === 'all'} evaluation={evals?.[p.id]} checking={checking} failed={prices.failed}
                  onClose={setClosingPos} onRoll={setRollingPos} onEdit={setEditingPos} onDelete={askDelete} />
              ))}
            </div>
          </>
        )
      ) : (
        <div className="card">
          <div className="hint" style={{ marginBottom: 12 }}>
            {scope === 'all' ? 'Every finished call, including stocks you no longer hold.' : `Finished calls on ${selected || 'this stock'}.`}
          </div>
          {closed.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>No finished calls yet.</div>
          ) : (
            <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  {scope === 'all' && <th>Stock</th>}
                  <th>Type</th><th className="num">Strike</th><th>Expiry</th><th className="num">Contracts</th>
                  <th>Result</th><th className="num">Collected</th><th className="num">Paid to close</th><th className="num">Fees</th>
                  <th className="num">Net <InfoTip text={TERMS.net} size={12} /></th><th>Closed</th><th><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {closed.map(p => {
                  const cost = p.close_cost
                  const net = optionNet(p)
                  const fees = totalFees(p)
                  const label = resultLabel(p, rolledIds)
                  return (
                    <tr key={p.id}>
                      {scope === 'all' && <td className="mono" style={{ fontWeight: 700, color: 'var(--text)' }}>{p.ticker}</td>}
                      <td><span className={`badge badge-${p.allocation_type === 'Income' ? 'accent' : 'violet'}`}>{p.allocation_type}</span></td>
                      <td className="mono num" style={{ color: 'var(--text)', fontWeight: 600 }}>{money(p.strike)}</td>
                      <td className="nowrap">{fmtDate(p.expiry)}</td>
                      <td className="mono num">{p.contracts}</td>
                      <td className="nowrap">{label === 'Assigned' ? <span className="badge badge-amber">Assigned</span> : label}</td>
                      <td className="mono num" style={{ color: 'var(--green)' }}>{money(p.premium_total)}</td>
                      <td className="mono num">
                        {cost == null
                          ? <button className="link-btn" style={{ fontSize: 13, color: 'var(--amber)' }} onClick={() => setEditingPos(p)}>Add cost</button>
                          : money(cost)}
                      </td>
                      <td className="mono num">{fees ? money(fees) : <span className="muted">—</span>}</td>
                      <td className="mono num" style={{ color: net == null ? 'var(--text-muted)' : net >= 0 ? 'var(--text)' : 'var(--red)' }}>{net == null ? '—' : money(net)}</td>
                      <td className="muted nowrap">{fmtDate(p.closed_at)}</td>
                      <td style={{ textAlign: 'right' }}>
                        <ActionMenu label={`Actions for the ${money(p.strike)} ${p.ticker} call`} items={[
                          { label: 'Edit', icon: Pencil, onClick: () => setEditingPos(p) },
                          p.status === 'EXPIRED'
                            ? { label: 'Shares were called away', icon: UserCheck, onClick: () => askCalledAway(p) }
                            : { label: rolledIds.has(p.id) ? 'Undo roll' : p.status === 'ASSIGNED' ? 'Undo assignment' : 'Reopen (undo close)', icon: Undo2, onClick: () => askUndo(p) },
                        ]} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            </div>
          )}
        </div>
      )}
      </>}
    </div>
  )
}
