// src/pages/Positions.jsx
import { useEffect, useState } from 'react'
import { getAllPositions, closePosition } from '../api/client'
import { useTicker } from '../context/TickerContext'

function ConfirmModal({ position, onConfirm, onCancel, loading }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}>
      <div className="card" style={{ width: 420, padding: 32, border: '1px solid rgba(239,68,68,0.3)', animation: 'fadeUp 0.2s ease forwards' }}>
        <div style={{ fontSize: 24, marginBottom: 12 }}>⚠️</div>
        <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 8 }}>Close Position?</div>
        <div style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 24, lineHeight: 1.6 }}>
          You are about to mark this position as closed:
          <div style={{ background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px', marginTop: 12, fontFamily: 'JetBrains Mono, monospace', fontSize: 13 }}>
            <div style={{ color: 'var(--text)', fontWeight: 700 }}>{position.ticker} — {position.allocation_type}</div>
            <div style={{ color: 'var(--text-muted)', marginTop: 4 }}>{position.expiry} | ${position.strike.toFixed(2)} strike | {position.contracts} contracts</div>
          </div>
          <div style={{ marginTop: 12, color: 'var(--red)', fontSize: 13 }}>This cannot be undone from the UI.</div>
        </div>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
          <button className="btn-secondary" onClick={onCancel} disabled={loading}>Cancel</button>
          <button className="btn-danger" onClick={onConfirm} disabled={loading} style={{ padding: '10px 20px' }}>
            {loading ? <span className="spinner" style={{ width: 14, height: 14 }} /> : 'Yes, Close Position'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Positions() {
  const { selected } = useTicker()
  const [positions, setPositions] = useState([])
  const [loading, setLoading]     = useState(true)
  const [filter, setFilter]       = useState('OPEN')
  const [closing, setClosing]     = useState(false)
  const [confirm, setConfirm]     = useState(null)

  const load = () => {
    setLoading(true)
    getAllPositions(selected)
      .then(r => setPositions(r.data))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [selected])

  const handleConfirm = async () => {
    if (!confirm) return
    setClosing(true)
    try { await closePosition(confirm.id); setConfirm(null); load() }
    finally { setClosing(false) }
  }

  const filtered    = filter === 'ALL' ? positions : positions.filter(p => p.status === filter)
  const openCount   = positions.filter(p => p.status === 'OPEN').length
  const closedCount = positions.filter(p => p.status === 'CLOSED').length

  return (
    <div className="fade-up">
      {confirm && <ConfirmModal position={confirm} onConfirm={handleConfirm} onCancel={() => setConfirm(null)} loading={closing} />}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.03em' }}>Positions</h1>
        {selected && (
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 14, color: 'var(--purple-light)', background: 'var(--purple-dim)', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 10px' }}>{selected}</span>
        )}
      </div>
      <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 32 }}>View and manage your covered call positions.</p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        {[['OPEN', `Open (${openCount})`], ['CLOSED', `Closed (${closedCount})`], ['ALL', `All (${positions.length})`]].map(([val, label]) => (
          <button key={val} onClick={() => setFilter(val)} style={{ padding: '8px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s', fontFamily: 'Syne, sans-serif', background: filter === val ? 'var(--purple-dim)' : 'transparent', border: filter === val ? '1px solid var(--purple)' : '1px solid var(--border)', color: filter === val ? 'var(--purple-light)' : 'var(--text-muted)' }}>{label}</button>
        ))}
      </div>

      <div className="card">
        {loading ? (
          <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner" style={{ width: 36, height: 36, margin: '0 auto' }} /></div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>◈</div>
            <div>No {filter.toLowerCase()} positions{selected ? ` for ${selected}` : ''}.</div>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr><th>ID</th><th>Ticker</th><th>Type</th><th>Expiry</th><th>Strike</th><th>Contracts</th><th>Entry</th><th>Premium</th><th>Status</th><th>Opened</th><th></th></tr>
            </thead>
            <tbody>
              {filtered.map(p => (
                <tr key={p.id}>
                  <td className="mono" style={{ color: 'var(--text-muted)' }}>#{p.id}</td>
                  <td style={{ fontWeight: 700, color: 'var(--text)', fontFamily: 'JetBrains Mono, monospace' }}>{p.ticker}</td>
                  <td><span className={`badge badge-${p.allocation_type === 'Income' ? 'purple' : 'green'}`}>{p.allocation_type}</span></td>
                  <td className="mono">{p.expiry}</td>
                  <td className="mono" style={{ color: 'var(--text)', fontWeight: 600 }}>${p.strike.toFixed(2)}</td>
                  <td className="mono">{p.contracts}</td>
                  <td className="mono">${p.entry_price.toFixed(2)}</td>
                  <td className="mono" style={{ color: 'var(--green)' }}>${p.premium_total.toFixed(2)}</td>
                  <td><span className={`badge badge-${p.status === 'OPEN' ? 'purple' : 'red'}`}>{p.status}</span></td>
                  <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{p.opened_at}</td>
                  <td>{p.status === 'OPEN' && <button className="btn-danger" onClick={() => setConfirm(p)}>Close</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
