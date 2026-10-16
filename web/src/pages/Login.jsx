// src/pages/Login.jsx — create an account or log in (email and password). Each account has
// its own portfolio. When there's a portfolio from before accounts, signing up with the old
// app password keeps it.
import { useEffect, useState } from 'react'
import { Eye, EyeOff, LockKeyhole, ShieldCheck } from 'lucide-react'
import { apiError, login, setToken, signup } from '../api/client'
import { Logo, Spinner } from '../components/ui'

const HAS_ACCOUNT = 'has_account'
const knownHere = () => { try { return localStorage.getItem(HAS_ACCOUNT) === '1' } catch { return false } }

export default function LoginPage({ canClaim, startWithLogin = false, onLoggedIn }) {
  const [mode, setMode]         = useState(() => (startWithLogin || knownHere() ? 'login' : 'signup'))
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [claim, setClaim]       = useState('')
  const [shown, setShown]       = useState(false)
  const [busy, setBusy]         = useState(false)
  const [error, setError]       = useState(null)
  const signingUp = mode === 'signup'
  useEffect(() => { document.title = `${signingUp ? 'Create an account' : 'Log in'} · CovCall` }, [signingUp])

  const switchTo = m => { setMode(m); setError(null) }

  const submit = async (e) => {
    e.preventDefault()
    if (!email.trim() || !password) { setError('Enter your email and password.'); return }
    setBusy(true); setError(null)
    try {
      const r = signingUp ? await signup(email, password, claim || null) : await login(email, password)
      setToken(r.data.token)
      try { localStorage.setItem(HAS_ACCOUNT, '1') } catch { /* storage unavailable */ }
      onLoggedIn()
    } catch (err) {
      setError(apiError(err, "Couldn't reach the server. Try again in a moment."))
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-12">
      <form className="page flex w-full max-w-[380px] flex-col" onSubmit={submit} aria-labelledby="auth-h" noValidate>
        <Logo size={44} />
        <h1 id="auth-h" className="mt-6 text-28 font-semibold tracking-title">
          {signingUp ? 'Get paid for shares you already own' : 'Log in to CovCall'}
        </h1>
        <p className="mt-2.5 text-15 text-fg-2">
          {signingUp
            ? 'CovCall finds a covered call for your stocks and tells you when to close it. You place the trades at your own broker.'
            : 'Welcome back. Your stocks and calls are where you left them.'}
        </p>

        <label className="label mt-8" htmlFor="auth-email">Email</label>
        <input id="auth-email" className="input" type="email" autoComplete="email" inputMode="email" autoFocus
          placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} aria-invalid={error ? true : undefined} />

        <label className="label mt-4" htmlFor="auth-password">Password</label>
        <span className="relative block">
          <input id="auth-password" className="input pr-14" type={shown ? 'text' : 'password'}
            autoComplete={signingUp ? 'new-password' : 'current-password'} placeholder={signingUp ? 'At least 10 characters' : ''}
            value={password} onChange={e => setPassword(e.target.value)} aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'auth-err' : undefined} />
          <button type="button" className="icon-btn absolute top-0.5 right-0.5 rounded-sm" aria-label={shown ? 'Hide password' : 'Show password'}
            aria-pressed={shown} onClick={() => setShown(s => !s)}>
            {shown ? <EyeOff size={19} strokeWidth={1.8} /> : <Eye size={19} strokeWidth={1.8} />}
          </button>
        </span>

        {signingUp && canClaim && (
          <>
            <label className="label mt-4" htmlFor="auth-claim">Old app password <span className="font-normal text-muted">(optional)</span></label>
            <input id="auth-claim" className="input" type="password" autoComplete="off" value={claim} onChange={e => setClaim(e.target.value)}
              aria-describedby="auth-claim-hint" />
            <p id="auth-claim-hint" className="field-hint">There's a portfolio here from before accounts. Enter the old app password to keep it in your account; leave it empty to start fresh.</p>
          </>
        )}

        {error && <p id="auth-err" role="alert" className="field-error">{error}</p>}

        <button type="submit" className="btn btn-primary btn-block mt-6" disabled={busy}>
          {busy ? <><Spinner /> {signingUp ? 'Creating your account…' : 'Checking…'}</> : signingUp ? 'Create account' : 'Log in'}
        </button>
        <p className="mt-4 text-center text-15 text-fg-2">
          {signingUp ? 'Already have an account? ' : 'New to CovCall? '}
          <button type="button" className="link" onClick={() => switchTo(signingUp ? 'login' : 'signup')}>
            {signingUp ? 'Log in' : 'Create an account'}
          </button>
        </p>

        <ul className="mt-10 flex flex-col gap-2.5 border-t border-line pt-5 text-13 text-muted">
          <li className="flex gap-2.5"><LockKeyhole size={16} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />Your stocks and trades are private to your account.</li>
          <li className="flex gap-2.5"><ShieldCheck size={16} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />CovCall never connects to your broker or places orders.</li>
        </ul>
      </form>
    </div>
  )
}
