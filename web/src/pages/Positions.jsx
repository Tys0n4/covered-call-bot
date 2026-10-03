// src/pages/Positions.jsx
// One place for your covered calls: what's open, whether to buy back, and history.
// (This page replaces the old separate Positions and Manage pages.)
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getAllPositions, getManagement, closePosition, apiError } from '../api/client'
import { useTicker } from '../context/TickerContext'
import { AlertTriangle, Layers, RefreshCw, CheckCircle2, Clock3, ScanLine, HelpCircle } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import InfoTip from '../components/InfoTip'
import Modal from '../components/Modal'
import ServerDown from '../components/ServerDown'
import { TERMS } from '../lib/terms'
import { fmtDate, daysUntil, money, plural } from '../lib/format'

// "12.5" style money input: digits and one dot
const cleanMoney = raw => {
  let t = raw.replace(/[^0-9.]/g, '')
  const dot = t.indexOf('.')
  if (dot !== -1) t = t.slice(0, dot + 1) + t.slice(dot + 1).replace(/\./g, '').slice(0, 2)
  return t.replace(/^0+(?=\d)/, '')
}

function ConfirmModal({ position, evaluation, onConfirm, onCancel, loading, error }) {
  // Pre-fill with the estimate from "Check prices" when there is one
  const estimate = evaluation?.current_option_price > 0 ? evaluation.cost_to_close : null
  const [costText, setCostText] = useState(estimate != null ? estimate.toFixed(2) : '')
  const cost = costText === '' || costText === '.' ? null : Number(costText)
  return (
    <Modal onBackdrop={() => { if (!loading) onCancel() }}>
      <div className="card" role="dialog" aria-modal="true" aria-label="Mark this call as closed" style={{ width: '100%', maxWidth: 440, padding: 28, border: '1px solid rgba(240,71,95,0.3)', animation: 'fadeUp 0.2s ease forwards' }}>
        <AlertTriangle size={24} strokeWidth={1.75} color="var(--red)" style={{ marginBottom: 12 }} />
        <div style={{ fontWeight: 700, fontSize: 19, marginBottom: 8 }}>Mark this call as closed?</div>
        <div style={{ color: 'var(--text-dim)', fontSize: 14, marginBottom: 24, lineHeight: 1.6 }}>
          Do this after you've bought the option back with your broker. (Expired calls are closed for you automatically.)
          <div style={{ background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px', marginTop: 12 }}>
            <div style={{ color: 'var(--text)', fontWeight: 700 }}>{position.ticker} · {money(position.strike)} call</div>
            <div className="hint" style={{ marginTop: 4 }}>Expires {fmtDate(position.expiry)} · {plural(position.contracts, 'contract')} · {position.allocation_type}</div>
          </div>
          <label className="label" htmlFor="close-cost" style={{ marginTop: 16 }}>What did you pay to buy it back? (total)</label>
          <div style={{ position: 'relative', maxWidth: 200 }}>
            <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}>$</span>
            <input id="close-cost" className="input" type="text" inputMode="decimal" autoComplete="off" placeholder="0.00"
              value={costText} onChange={e => setCostText(cleanMoney(e.target.value))} style={{ paddingLeft: 28 }} />
          </div>
          <div className="hint" style={{ marginTop: 6 }}>
            {estimate != null ? `Filled in from the latest price check (${money(estimate)}). ` : ''}
            Optional, but it keeps your monthly income goal accurate. Collected {money(position.premium_total)}
            {cost != null ? <>, so you keep <strong style={{ color: 'var(--green)' }}>{money(position.premium_total - cost)}</strong></> : ''}.
          </div>
          {error && <div style={{ marginTop: 10, color: 'var(--red)', fontSize: 13 }}>{error}</div>}
          <div style={{ marginTop: 12, color: 'var(--red)', fontSize: 13 }}>This can't be undone from the app.</div>
        </div>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
          <button className="btn-secondary" onClick={onCancel} disabled={loading}>Cancel</button>
          <button className="btn-danger" onClick={() => onConfirm(cost)} disabled={loading} style={{ padding: '10px 20px' }}>
            {loading ? <span className="spinner" style={{ width: 14, height: 14 }} /> : 'Yes, mark closed'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

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
          Premium kept <InfoTip text={TERMS.profit} size={12} align="right" />
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

function PositionCard({ p, evaluation, checked, onClose }) {
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
          </div>
        </div>
        <div>
          <StatusPanel evaluation={evaluation} checked={checked} />
          <div style={{ marginTop: 12, textAlign: 'right' }}>
            <button className="link-btn" style={{ color: buy ? 'var(--green)' : 'var(--text-muted)', fontSize: 13 }} onClick={() => onClose(p)}>
              {buy ? 'I bought it back: mark closed' : 'Mark as closed'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Positions() {
  const { selected } = useTicker()
  const [reloadKey, setReloadKey] = useState(0)
  const [fetched, setFetched]     = useState({ key: null, positions: [] })
  const [tab, setTab]             = useState('OPEN')
  const [closing, setClosing]     = useState(false)
  const [confirm, setConfirm]     = useState(null)
  const [evals, setEvals]         = useState(null)   // id -> evaluation, after "Check prices"
  const [checking, setChecking]   = useState(false)
  const [error, setError]         = useState(null)
  const [closeError, setCloseError] = useState(null)
  const [historyScope, setHistoryScope] = useState('stock')   // 'stock' | 'all'

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

  const handleConfirm = async (cost) => {
    if (!confirm) return
    setClosing(true); setCloseError(null)
    try { await closePosition(confirm.id, cost); setConfirm(null); reload() }
    catch (e) { setCloseError(apiError(e, 'Could not close this call. Is the API running?')) }
    finally { setClosing(false) }
  }

  const open      = positions.filter(p => p.status === 'OPEN' && p.ticker === selected)
  const finished  = positions.filter(p => p.status !== 'OPEN')
  const closed    = (historyScope === 'all' ? finished : finished.filter(p => p.ticker === selected))
    .slice().sort((a, b) => (b.closed_at || '').localeCompare(a.closed_at || '') || b.id - a.id)
  const readyCount = evals ? open.filter(p => evals[p.id]?.should_buy_back).length : 0

  return (
    <div className="fade-up">
      {confirm && <ConfirmModal position={confirm} evaluation={evals?.[confirm.id]} onConfirm={handleConfirm}
        onCancel={() => { setConfirm(null); setCloseError(null) }} loading={closing} error={closeError} />}

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
                  <PositionCard key={p.id} p={p} evaluation={evals?.[p.id]} checked={!!evals} onClose={setConfirm} />
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
                  <th>Result</th><th className="num">Collected</th><th className="num">Paid to close</th><th className="num">Kept</th><th>Closed</th>
                </tr>
              </thead>
              <tbody>
                {closed.map(p => {
                  const cost = p.close_cost
                  return (
                    <tr key={p.id}>
                      {historyScope === 'all' && <td className="mono" style={{ fontWeight: 700, color: 'var(--text)' }}>{p.ticker}</td>}
                      <td><span className={`badge badge-${p.allocation_type === 'Income' ? 'accent' : 'blue'}`}>{p.allocation_type}</span></td>
                      <td className="mono num" style={{ color: 'var(--text)', fontWeight: 600 }}>{money(p.strike)}</td>
                      <td>{fmtDate(p.expiry)}</td>
                      <td className="mono num">{p.contracts}</td>
                      <td>{p.status === 'EXPIRED' ? 'Expired' : 'Bought back'}</td>
                      <td className="mono num" style={{ color: 'var(--green)' }}>{money(p.premium_total)}</td>
                      <td className="mono num">{cost == null ? <span className="muted" title="Not entered when it was closed">—</span> : money(cost)}</td>
                      <td className="mono num" style={{ color: cost == null ? 'var(--text-muted)' : 'var(--text)' }}>{cost == null ? '—' : money(p.premium_total - cost)}</td>
                      <td className="muted">{fmtDate(p.closed_at)}</td>
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
