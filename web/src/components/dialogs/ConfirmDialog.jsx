// src/components/dialogs/ConfirmDialog.jsx — "Are you sure?" for actions like delete or undo
import { useState } from 'react'
import Modal from './Modal'
import { Spinner } from '../ui'

export default function ConfirmDialog({ title, children, confirmLabel, danger = false, onConfirm, onCancel }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const confirm = async () => {
    setBusy(true); setError(null)
    try { await onConfirm() }
    catch (e) { setError(e?.message || 'Something went wrong.'); setBusy(false) }
  }

  return (
    <Modal onDismiss={() => { if (!busy) onCancel() }} role="alertdialog" labelledBy="confirm-title" width={440}>
      <h2 id="confirm-title" className="text-22 font-semibold tracking-title">{title}</h2>
      <p className="mt-2 text-15 text-fg-2">{children}</p>
      {error && <p role="alert" className="mt-3 text-13 text-loss">{error}</p>}
      <div className="dialog-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy} autoFocus>Cancel</button>
        <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={confirm} disabled={busy}>
          {busy ? <Spinner /> : confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
