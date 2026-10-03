// src/pages/Login.jsx — password screen, shown when the API has APP_PASSWORD set
import { useState } from 'react'
import { AlertTriangle, Lock } from 'lucide-react'
import { apiError, login, setToken } from '../api/client'

export default function LoginPage({ onLoggedIn }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy]         = useState(false)
  const [error, setError]       = useState(null)

  const submit = async (e) => {
    e.preventDefault()
    if (!password) { setError('Enter your password.'); return }
    setBusy(true); setError(null)
    try {
      const r = await login(password)
      setToken(r.data.token)
      onLoggedIn()
    } catch (err) {
      setError(apiError(err, "Couldn't reach the server. Try again in a moment."))
      setBusy(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <form className="card fade-up" onSubmit={submit} style={{ width: '100%', maxWidth: 380, padding: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
          <div className="logo-mark">C</div>
          <div style={{ lineHeight: 1.2 }}>
            <div style={{ fontWeight: 700, fontSize: 16 }}>CovCall</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Covered call scanner</div>
          </div>
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>Log in</h1>
        <div className="hint" style={{ marginBottom: 20 }}>Enter the password set on your server.</div>
        <label className="label" htmlFor="password">Password</label>
        <input id="password" className="input" type="password" autoComplete="current-password" autoFocus
          value={password} onChange={e => setPassword(e.target.value)} />
        {error && (
          <div className="callout callout-red" role="alert" style={{ marginTop: 14, padding: '10px 12px', fontSize: 13 }}>
            <AlertTriangle size={16} strokeWidth={1.75} style={{ flexShrink: 0, marginTop: 1 }} /> {error}
          </div>
        )}
        <button type="submit" className="btn-primary" disabled={busy} style={{ width: '100%', justifyContent: 'center', marginTop: 20 }}>
          {busy ? <><span className="spinner" /> Checking…</> : <><Lock size={15} strokeWidth={2} /> Log in</>}
        </button>
      </form>
    </div>
  )
}
