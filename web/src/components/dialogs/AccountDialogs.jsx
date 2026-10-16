// src/components/dialogs/AccountDialogs.jsx — Strategy › Account and security: change your
// password, make a new recovery code, delete your account. Each asks for your password.
import { useState } from 'react'
import { apiError, changePassword, clearToken, deleteAccount, newRecoveryCode, setToken } from '../../api/client'
import Modal, { DialogHead } from './Modal'
import { RecoveryCodeBox, RecoveryCodeNotes } from '../RecoveryCode'
import { Field, Spinner } from '../ui'

function PasswordField({ id, label, value, onChange, error, autoComplete = 'current-password', hint }) {
  return (
    <Field id={id} label={label} type="password" autoComplete={autoComplete} value={value} hint={hint}
      onChange={e => onChange(e.target.value)} error={error} />
  )
}

export function ChangePasswordModal({ onDone, onCancel }) {
  const [current, setCurrent] = useState('')
  const [next, setNext]       = useState('')
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState(null)
  const tooShort = next.length > 0 && next.length < 10

  const submit = async e => {
    e.preventDefault()
    if (!current || next.length < 10) return
    setBusy(true); setError(null)
    try {
      const r = await changePassword(current, next)
      setToken(r.data.token)          // this device stays logged in; the others are out
      onDone()
    } catch (err) {
      setError(apiError(err, "Couldn't change your password. Try again in a moment."))
      setBusy(false)
    }
  }

  return (
    <Modal as="form" onSubmit={submit} onDismiss={() => { if (!busy) onCancel() }} labelledBy="pw-title" width={440}>
      <DialogHead id="pw-title" title="Change password" sub="Your other devices are logged out." onClose={onCancel} disabled={busy} />
      <div className="mt-5 flex flex-col gap-4">
        <PasswordField id="pw-current" label="Current password" value={current} onChange={setCurrent} />
        <PasswordField id="pw-new" label="New password" value={next} onChange={setNext} autoComplete="new-password"
          error={tooShort ? 'Use at least 10 characters' : null} hint="At least 10 characters" />
      </div>
      {error && <p role="alert" className="mt-3 text-13 text-loss">{error}</p>}
      <div className="dialog-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={busy || !current || next.length < 10}>
          {busy ? <Spinner /> : 'Change password'}
        </button>
      </div>
    </Modal>
  )
}

// Password first (so a stolen login can't make a code), then the new code, shown once
export function RecoveryCodeModal({ email, onDone, onCancel }) {
  const [password, setPassword] = useState('')
  const [code, setCode]         = useState(null)
  const [busy, setBusy]         = useState(false)
  const [error, setError]       = useState(null)

  const submit = async e => {
    e.preventDefault()
    if (!password) return
    setBusy(true); setError(null)
    try {
      const r = await newRecoveryCode(password)
      setCode(r.data.recovery_code)
    } catch (err) {
      setError(apiError(err, "Couldn't make a new code. Try again in a moment."))
    } finally {
      setBusy(false)
    }
  }

  if (code) {
    return (
      <Modal onDismiss={onDone} labelledBy="code-title" width={440}>
        <DialogHead id="code-title" title="Your new recovery code" sub="Your old code doesn't work any more." onClose={onDone} />
        <div className="mt-5"><RecoveryCodeBox code={code} email={email} /></div>
        <RecoveryCodeNotes />
        <div className="dialog-actions">
          <button type="button" className="btn btn-primary" onClick={onDone}>I saved it</button>
        </div>
      </Modal>
    )
  }
  return (
    <Modal as="form" onSubmit={submit} onDismiss={() => { if (!busy) onCancel() }} labelledBy="code-title" width={440}>
      <DialogHead id="code-title" title="Make a new recovery code" onClose={onCancel} disabled={busy}
        sub="It's how you set a new password if you forget yours. Any code you saved before stops working." />
      <div className="mt-5"><PasswordField id="code-password" label="Your password" value={password} onChange={setPassword} /></div>
      {error && <p role="alert" className="mt-3 text-13 text-loss">{error}</p>}
      <div className="dialog-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={busy || !password}>{busy ? <Spinner /> : 'Make a new code'}</button>
      </div>
    </Modal>
  )
}

export function DeleteAccountModal({ email, onCancel }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy]         = useState(false)
  const [error, setError]       = useState(null)

  const submit = async e => {
    e.preventDefault()
    if (!password) return
    setBusy(true); setError(null)
    try {
      await deleteAccount(password)
      try { localStorage.removeItem('has_account') } catch { /* storage unavailable */ }
      clearToken()
      window.location.assign('/')
    } catch (err) {
      setError(apiError(err, "Couldn't delete your account. Try again in a moment."))
      setBusy(false)
    }
  }

  return (
    <Modal as="form" onSubmit={submit} onDismiss={() => { if (!busy) onCancel() }} role="alertdialog" labelledBy="del-title" width={440}>
      <DialogHead id="del-title" title="Delete your account?" onClose={onCancel} disabled={busy} />
      <p className="mt-2 text-15 text-fg-2">
        {email ? <><strong className="font-semibold text-fg">{email}</strong> and everything in it</> : 'Your account and everything in it'}: your
        stocks, every call you recorded, your strategy and Discord alerts. This can't be undone. Download your data first if you want a copy.
      </p>
      <div className="mt-5"><PasswordField id="del-password" label="Your password" value={password} onChange={setPassword} /></div>
      {error && <p role="alert" className="mt-3 text-13 text-loss">{error}</p>}
      <div className="dialog-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="submit" className="btn btn-danger" disabled={busy || !password}>{busy ? <Spinner /> : 'Delete my account'}</button>
      </div>
    </Modal>
  )
}
