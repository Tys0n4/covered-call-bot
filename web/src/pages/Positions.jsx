// src/pages/Positions.jsx
// One place for your covered calls: what's open, whether to buy back, and history.
// (This page replaces the old separate Positions and Manage pages.)
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getAllPositions, getManagement, closePosition } from '../api/client'
import { useTicker } from '../context/TickerContext'
import { AlertTriangle, Layers, RefreshCw, CheckCircle2, Clock3, ScanLine } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import InfoTip from '../components/InfoTip'
import Modal from '../components/Modal'
import { TERMS } from '../lib/terms'
import { fmtDate, daysUntil, money, plural } from '../lib/format'

function ConfirmModal({ position, onConfirm, onCancel, loading }) {
  return (
    <Modal onBackdrop={() => { if (!loading) onCancel() }}>
      <div className="card" style={{ width: 440, padding: 32, border: '1px solid rgba(240,71,95,0.3)', animation: 'fadeUp 0.2s ease forwards' }}>
        <AlertTriangle size={24} strokeWidth={1.75} color="var(--red)" style={{ marginBottom: 12 }} />
        <div style={{ fontWeight: 700, fontSize: 19, marginBottom: 8 }}>Mark this call as closed?</div>
        <div style={{ color: 'var(--text-dim)', fontSize: 14, marginBottom: 24, lineHeight: 1.6 }}>
          Do this after you've bought the option back with your broker, or once it has expired.
          <div style={{ background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px', marginTop: 12 }}>
            <div style={{ color: 'var(--text)', fontWeight: 700 }}>{position.ticker} · {money(position.strike)} call</div>
            <div className="hint" style={{ marginTop: 4 }}>Expires {fmtDate(position.expiry)} · {plural(position.contracts, 'contract')} · {position.allocation_type}</div>
          </div>
          <div style={{ marginTop: 12, color: 'var(--red)', fontSize: 13 }}>This can't be undone from the app.</div>
        </div>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
          <button className="btn-secondary" onClick={onCancel} disabled={loading}>Cancel</button>
          <button className="btn-danger" onClick={onConfirm} disabled={loading} style={{ padding: '10px 20px' }}>
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
      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: 32, alignItems: 'center' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <span className={`badge badge-${p.allocation_type === 'Income' ? 'accent' : 'blue'}`}>{p.allocation_type}</span>
            <span className="hint">Opened {fmtDate(p.opened_at)}</span>
          </div>
          <div style={{ fontSize: 19, fontWeight: 700, marginBottom: 4 }}>
            {money(p.strike)} call <span className="muted" style={{ fontWeight: 500, fontSize: 15 }}>
              · expires {fmtDate(p.expiry)}{days != null && days >= 0 ? ` (${plural(days, 'day')})` : ''}
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

  // Price checks and errors belong to one stock; clear them when you switch
  const [shownFor, setShownFor] = useState(selected)
  if (shownFor !== selected) {
    setShownFor(selected); setEvals(null); setError(null)
  }

  const fetchKey = `${selected}|${reloadKey}`
  useEffect(() => {
    let cancelled = false
    getAllPositions(selected)
      .then(r => { if (!cancelled) setFetched({ key: fetchKey, positions: r.data }) })
      .catch(() => {
        if (cancelled) return
        setFetched({ key: fetchKey, positions: [] })
        setError('Could not load positions. Is the API running?')
      })
    return () => { cancelled = true }
  }, [selected, fetchKey])

  const loading   = fetched.key !== fetchKey
  const positions = fetched.positions
  const reload    = () => setReloadKey(k => k + 1)

  const handleCheck = async () => {
    setChecking(true); setError(null)
    try {
      const res = await getManagement(selected)
      setEvals(Object.fromEntries(res.data.positions.map(e => [e.id, e])))
    } catch {
      setError('Could not check prices. Is the API running?')
    } finally {
      setChecking(false)
    }
  }

  const handleConfirm = async () => {
    if (!confirm) return
    setClosing(true)
    try { await closePosition(confirm.id); setConfirm(null); reload() }
    finally { setClosing(false) }
  }

  const open   = positions.filter(p => p.status === 'OPEN')
  const closed = positions.filter(p => p.status !== 'OPEN')
  const readyCount = evals ? open.filter(p => evals[p.id]?.should_buy_back).length : 0

  return (
    <div className="fade-up">
      {confirm && <ConfirmModal position={confirm} onConfirm={handleConfirm} onCancel={() => setConfirm(null)} loading={closing} />}

      <PageHeader
        title="Positions"
        showTicker
        subtitle={`Your covered calls${selected ? ` on ${selected}` : ''} and what to do with each one.`}
        actions={open.length > 0 && (
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
          {closed.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>No closed calls yet.</div>
          ) : (
            <table className="data-table">
              <thead>
                <tr><th>Type</th><th className="num">Strike</th><th>Expired</th><th className="num">Contracts</th><th className="num">Premium collected</th><th>Opened</th></tr>
              </thead>
              <tbody>
                {closed.map(p => (
                  <tr key={p.id}>
                    <td><span className={`badge badge-${p.allocation_type === 'Income' ? 'accent' : 'blue'}`}>{p.allocation_type}</span></td>
                    <td className="mono num" style={{ color: 'var(--text)', fontWeight: 600 }}>{money(p.strike)}</td>
                    <td>{fmtDate(p.expiry)}</td>
                    <td className="mono num">{p.contracts}</td>
                    <td className="mono num" style={{ color: 'var(--green)' }}>{money(p.premium_total)}</td>
                    <td className="muted">{fmtDate(p.opened_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
