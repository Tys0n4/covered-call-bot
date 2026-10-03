// src/components/dialogs/ConfirmDialog.jsx — "Are you sure?" for actions like delete or undo
import { useState } from 'react'
import Modal from './Modal'

export default function ConfirmDialog({ title, children, confirmLabel, danger = false, onConfirm, onCancel }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const confirm = async () => {
    setBusy(true); setError(null)
    try { await onConfirm() }
    catch (e) { setError(e?.message || 'Something went wrong.'); setBusy(false) }
  }

  return (
    <Modal onDismiss={() => { if (!busy) onCancel() }}>
      <div className="card" role="alertdialog" aria-modal="true" aria-label={title}
        style={{ width: '100%', maxWidth: 420, padding: 26, animation: 'fadeUp 0.2s ease forwards' }}>
        <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>{title}</div>
        <div className="hint" style={{ fontSize: 14, color: 'var(--text-dim)', lineHeight: 1.55 }}>{children}</div>
        {error && <div role="alert" style={{ marginTop: 12, color: 'var(--red)', fontSize: 13 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 22 }}>
          <button className="btn-secondary" onClick={onCancel} disabled={busy} autoFocus>Cancel</button>
          <button className={danger ? 'btn-danger' : 'btn-primary'} style={danger ? { padding: '10px 18px', fontSize: 14 } : undefined}
            onClick={confirm} disabled={busy}>
            {busy ? <span className="spinner" style={{ width: 14, height: 14 }} /> : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  )
}
