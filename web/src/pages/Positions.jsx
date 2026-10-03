// src/pages/Positions.jsx
// One place for your covered calls: what's open, whether to buy back, and history.
// (This page replaces the old separate Positions and Manage pages.)
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { getAllPositions, getManagement, getAssignmentReview, apiError } from '../api/client'
import { useTicker } from '../context/TickerContext'
import { AlertTriangle, Layers, RefreshCw, CheckCircle2, Clock3, ScanLine, HelpCircle, Repeat } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import InfoTip from '../components/InfoTip'
import ServerDown from '../components/ServerDown'
import CloseModal from '../components/CloseModal'
import RollModal from '../components/RollModal'
import AssignmentReview from '../components/AssignmentReview'
import EditTradeModal from '../components/EditTradeModal'
import HistoryActions from '../components/HistoryActions'
import { TERMS } from '../lib/terms'
import { fmtDate, daysUntil, money, plural } from '../lib/format'
import { optionNet, resultLabel, totalFees } from '../lib/pnl'

function StatusPanel({ evaluation, checked }) {
  if (!checked) {
    return <div className="hint">Not checked yet. Use <strong style={{ color: 'var(--text-dim)' }}>Check prices</strong> to see if it's time to buy back.</div>
  }
  if (!evaluation) {
    return <div className="hint">No price data for this call.</div>
  }
  if (!(evaluation.current_option_price > 0)) {
    return (
      <div>
        <span className="badge" style={{ fontSize: 13, background: 'rgba(255,255,255,0.06)', color: 'var(--text-dim)', border: '1px solid var(--border)' }}>
          <HelpCircle size={14} strokeWidth={2} /> Price unavailable
        </span>
        <div className="hint" style={{ marginTop: 8 }}>
          Couldn't get a price for this call right now (common outside market hours). Check again while the market is open.
        </div>
      </div>
    )
  }
  const kept = Math.max(0, Math.min(evaluation.profit_capture_pct, 100))
  const buy = evaluation.should_buy_back
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 12 }}>
        {buy
          ? <span className="badge badge-green" style={{ fontSize: 13 }}><CheckCircle2 size={14} strokeWidth={2} /> Buy back now</span>
          : <span className="badge badge-amber" style={{ fontSize: 13 }}><Clock3 size={14} strokeWidth={2} /> Keep holding</span>}
        <span className="fact-label" style={{ margin: 0 }}>
          Premium kept <InfoTip text={TERMS.profit} size={12} />
          <strong className="mono" style={{ color: buy ? 'var(--green)' : 'var(--text)', marginLeft: 4 }}>{evaluation.profit_capture_pct.toFixed(0)}%</strong>
        </span>
      </div>
      <div className="progress-bar">
        <div className="progress-fill" style={{ width: `${kept}%`, background: buy ? 'linear-gradient(90deg, #1fc99a, #34edb3)' : 'linear-gradient(90deg, var(--accent), var(--accent-light))' }} />
      </div>
      <div className="hint" style={{ marginTop: 8 }}>
        {evaluation.current_option_price > 0
          ? (buy
              ? <>Buying back now costs about <strong style={{ color: 'var(--text)' }}>{money(evaluation.cost_to_close)}</strong> and locks in the gain.</>
              : <>It would cost {money(evaluation.cost_to_close)} to buy back today. Not worth it yet.</>)
          : <span style={{ color: 'var(--amber)', display: 'inline-flex', alignItems: 'center', gap: 5 }}><AlertTriangle size={13} strokeWidth={1.75} /> Couldn't get the current price. Check it with your broker.</span>}
      </div>
    </div>
  )
}

function PositionCard({ p, evaluation, checked, onClose, onRoll, onEdit }) {
  const days = daysUntil(p.expiry)
  const buy = evaluation?.should_buy_back
  return (
    <div className="card" style={{ borderColor: buy ? 'rgba(52,237,179,0.35)' : undefined }}>
      <div className="grid-split">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <span className={`badge badge-${p.allocation_type === 'Income' ? 'accent' : 'blue'}`}>{p.allocation_type}</span>
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
            {p.rolled_from && <span className="badge badge-blue" style={{ marginLeft: 8 }}>Rolled</span>}
          </div>
        </div>
        <div>
          <StatusPanel evaluation={evaluation} checked={checked} />
          <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end', gap: 18 }}>
            <button className="link-btn" style={{ color: 'var(--text-muted)', fontSize: 13 }} onClick={() => onEdit(p)}>
              Edit
            </button>
            <button className="link-btn" style={{ color: 'var(--text-muted)', fontSize: 13 }} onClick={() => onRoll(p)}>
              <Repeat size={13} strokeWidth={2} /> Roll
            </button>
            <button className="link-btn" style={{ color: buy ? 'var(--green)' : 'var(--text-muted)', fontSize: 13 }} onClick={() => onClose(p)}>
              {buy ? 'I bought it back: close' : 'Close'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Positions() {
  const { selected, refresh: refreshTickers } = useTicker()
  const [reloadKey, setReloadKey] = useState(0)
  const [fetched, setFetched]     = useState({ key: null, positions: [] })
  const [params] = useSearchParams()
  const [tab, setTab]             = useState(params.get('tab') === 'history' ? 'CLOSED' : 'OPEN')
  const [closingPos, setClosingPos] = useState(null)   // position in the Close dialog
  const [rollingPos, setRollingPos] = useState(null)   // position in the Roll dialog
  const [review, setReview]       = useState([])       // expired calls that may have been assigned
  const [evals, setEvals]         = useState(null)   // id -> evaluation, after "Check prices"
  const [checking, setChecking]   = useState(false)
  const [error, setError]         = useState(null)
  const [historyScope, setHistoryScope] = useState(params.get('scope') === 'all' ? 'all' : 'stock')   // 'stock' | 'all'
  const [editingPos, setEditingPos] = useState(null)   // position in the Edit dialog

  // Price checks and errors belong to one stock; clear them when you switch
  const [shownFor, setShownFor] = useState(selected)
  if (shownFor !== selected) {
    setShownFor(selected); setEvals(null); setError(null)
  }

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

  const handleCheck = async () => {
    setChecking(true); setError(null)
    try {
      const res = await getManagement(selected)
      setEvals(Object.fromEntries(res.data.positions.map(e => [e.id, e])))
    } catch (e) {
      setError(apiError(e, 'Could not check prices. Is the API running?'))
    } finally {
      setChecking(false)
    }
  }

  // After a close, roll or assignment: reload trades; an assignment also changes your share count
  const afterChange = (how) => {
    setClosingPos(null); setRollingPos(null); setEditingPos(null); setEvals(null); setError(null)
    reload()
    if (how === 'assigned') refreshTickers().catch(() => {})   // share count changed
  }

  const open      = positions.filter(p => p.status === 'OPEN' && p.ticker === selected)
  const finished  = positions.filter(p => p.status !== 'OPEN')
  const rolledIds = new Set(positions.filter(p => p.rolled_from).map(p => p.rolled_from))
  const closed    = (historyScope === 'all' ? finished : finished.filter(p => p.ticker === selected))
    .slice().sort((a, b) => (b.closed_at || '').localeCompare(a.closed_at || '') || b.id - a.id)
  const readyCount = evals ? open.filter(p => evals[p.id]?.should_buy_back).length : 0

  return (
    <div className="fade-up">
      {closingPos && <CloseModal position={closingPos} evaluation={evals?.[closingPos.id]}
        onDone={afterChange} onCancel={() => setClosingPos(null)} />}
      {editingPos && <EditTradeModal position={editingPos} onDone={() => afterChange('edited')} onCancel={() => setEditingPos(null)} />}
      {rollingPos && <RollModal position={rollingPos} evaluation={evals?.[rollingPos.id]}
        onDone={() => afterChange('rolled')} onCancel={() => setRollingPos(null)} />}

      <PageHeader
        title="Positions"
        showTicker
        subtitle={`Your covered calls${selected ? ` on ${selected}` : ''} and what to do with each one.`}
        actions={open.length > 0 && !fetched.failed && (
          <button className="btn-primary" onClick={handleCheck} disabled={checking || !selected}>
            {checking ? <><span className="spinner" /> Checking prices…</> : <><RefreshCw size={15} strokeWidth={2} /> Check prices</>}
          </button>
        )}
      />

      {error && (
        <div className="callout callout-red" style={{ marginBottom: 20 }}>
          <AlertTriangle size={18} strokeWidth={1.75} /> {error}
        </div>
      )}

      {fetched.failed && !loading ? <ServerDown onRetry={reload} /> : <>
      <AssignmentReview items={review} onChanged={() => afterChange('assigned')} />

      <div className="tabs" style={{ marginBottom: 20 }}>
        <button className={`tab ${tab === 'OPEN' ? 'active' : ''}`} onClick={() => setTab('OPEN')}>Open ({open.length})</button>
        <button className={`tab ${tab === 'CLOSED' ? 'active' : ''}`} onClick={() => setTab('CLOSED')}>History ({closed.length})</button>
      </div>

      {loading ? (
        <div className="card" style={{ textAlign: 'center', padding: 60 }}><div className="spinner" style={{ width: 36, height: 36, margin: '0 auto' }} /></div>
      ) : tab === 'OPEN' ? (
        open.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: 60 }}>
            <Layers size={28} strokeWidth={1.75} style={{ opacity: 0.4, marginBottom: 10 }} />
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>No open calls{selected ? ` on ${selected}` : ''}</div>
            <div className="hint" style={{ marginBottom: 18 }}>Run a scan to find one to sell.</div>
            <Link to="/scanner"><button className="btn-primary"><ScanLine size={15} strokeWidth={2} /> Go to Scanner</button></Link>
          </div>
        ) : (
          <>
            {evals && (
              <div className={`callout ${readyCount > 0 ? 'callout-green' : 'callout-amber'}`} style={{ marginBottom: 16 }}>
                {readyCount > 0
                  ? <><CheckCircle2 size={18} strokeWidth={1.75} /> {readyCount} of {plural(open.length, 'call')} {readyCount === 1 ? 'is' : 'are'} ready to buy back.</>
                  : <><Clock3 size={18} strokeWidth={1.75} /> Nothing to do right now. Keep holding all {plural(open.length, 'call')}.</>}
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {open
                .slice()
                .sort((a, b) => (evals?.[b.id]?.should_buy_back ? 1 : 0) - (evals?.[a.id]?.should_buy_back ? 1 : 0))
                .map(p => (
                  <PositionCard key={p.id} p={p} evaluation={evals?.[p.id]} checked={!!evals} onClose={setClosingPos} onRoll={setRollingPos} onEdit={setEditingPos} />
                ))}
            </div>
          </>
        )
      ) : (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
            <div className="hint">
              {historyScope === 'all' ? 'Every finished call, including stocks you no longer hold.' : `Finished calls on ${selected || 'this stock'}.`}
            </div>
            <div className="tabs" role="group" aria-label="Which stocks">
              <button className={`tab ${historyScope === 'stock' ? 'active' : ''}`} onClick={() => setHistoryScope('stock')}>This stock</button>
              <button className={`tab ${historyScope === 'all' ? 'active' : ''}`} onClick={() => setHistoryScope('all')}>All stocks ({finished.length})</button>
            </div>
          </div>
          {closed.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>No finished calls yet.</div>
          ) : (
            <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  {historyScope === 'all' && <th>Stock</th>}
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
                      {historyScope === 'all' && <td className="mono" style={{ fontWeight: 700, color: 'var(--text)' }}>{p.ticker}</td>}
                      <td><span className={`badge badge-${p.allocation_type === 'Income' ? 'accent' : 'blue'}`}>{p.allocation_type}</span></td>
                      <td className="mono num" style={{ color: 'var(--text)', fontWeight: 600 }}>{money(p.strike)}</td>
                      <td>{fmtDate(p.expiry)}</td>
                      <td className="mono num">{p.contracts}</td>
                      <td>{label === 'Assigned' ? <span className="badge badge-amber">Assigned</span> : label}</td>
                      <td className="mono num" style={{ color: 'var(--green)' }}>{money(p.premium_total)}</td>
                      <td className="mono num">
                        {cost == null
                          ? <button className="link-btn" style={{ fontSize: 13, color: 'var(--amber)' }} onClick={() => setEditingPos(p)}>Add cost</button>
                          : money(cost)}
                      </td>
                      <td className="mono num">{fees ? money(fees) : <span className="muted">—</span>}</td>
                      <td className="mono num" style={{ color: net == null ? 'var(--text-muted)' : net >= 0 ? 'var(--text)' : 'var(--red)' }}>{net == null ? '—' : money(net)}</td>
                      <td className="muted">{fmtDate(p.closed_at)}</td>
                      <td style={{ textAlign: 'right' }}>
                        <HistoryActions p={p} rolled={rolledIds.has(p.id)} onEdit={setEditingPos} onChanged={afterChange} onError={setError} />
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
