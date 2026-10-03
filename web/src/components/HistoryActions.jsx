// src/components/HistoryActions.jsx — Edit / Undo (and "called away?") for a finished call
import { useState } from 'react'
import { apiError, assignPosition, undoPosition } from '../api/client'

export default function HistoryActions({ p, rolled, onEdit, onChanged, onError }) {
  const [confirming, setConfirming] = useState(null)   // 'undo' | 'assign'
  const [busy, setBusy] = useState(false)

  const run = async (fn, how) => {
    setBusy(true)
    try { await fn(p.id); setConfirming(null); onChanged(how) }
    catch (e) { onError(apiError(e, 'Could not save that. Is the API running?')) }
    finally { setBusy(false) }
  }

  if (confirming) {
    const label = confirming === 'assign' ? 'Shares called away?' : rolled ? 'Undo the roll?' : 'Reopen this call?'
    return (
      <span style={{ display: 'inline-flex', gap: 10, alignItems: 'center', whiteSpace: 'nowrap' }}>
        <span style={{ color: 'var(--text)' }}>{label}</span>
        <button className="link-btn" style={{ fontSize: 13 }} disabled={busy}
          onClick={() => run(confirming === 'assign' ? assignPosition : undoPosition, confirming === 'assign' || p.status === 'ASSIGNED' ? 'assigned' : 'undone')}>
          {busy ? <span className="spinner" style={{ width: 12, height: 12 }} /> : 'Yes'}
        </button>
        <button className="link-btn" style={{ fontSize: 13, color: 'var(--text-muted)' }} disabled={busy} onClick={() => setConfirming(null)}>No</button>
      </span>
    )
  }

  const undoTitle = p.status === 'ASSIGNED'
    ? 'Undo the assignment: the shares go back into your holding'
    : rolled ? 'Undo the roll: removes the new call and reopens this one' : 'Reopen this call'
  return (
    <span style={{ display: 'inline-flex', gap: 14, whiteSpace: 'nowrap' }}>
      <button className="link-btn" style={{ fontSize: 13 }} onClick={() => onEdit(p)}>Edit</button>
      {p.status === 'EXPIRED' ? (
        <button className="link-btn" style={{ fontSize: 13, color: 'var(--text-muted)' }} title="Record that your shares were called away"
          onClick={() => setConfirming('assign')}>Called away?</button>
      ) : (
        <button className="link-btn" style={{ fontSize: 13, color: 'var(--text-muted)' }} title={undoTitle}
          onClick={() => setConfirming('undo')}>{rolled ? 'Undo roll' : 'Undo'}</button>
      )}
    </span>
  )
}
