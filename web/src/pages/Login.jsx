// src/pages/Login.jsx — create an account or log in (email and password). Each account has
// its own portfolio. When there's a portfolio from before accounts, signing up with the old
// app password keeps it. Forgot your password? Your recovery code sets a new one.
import { useEffect, useState } from 'react'
import { Eye, EyeOff, LockKeyhole, ShieldCheck } from 'lucide-react'
import { apiError, login, recover, setToken, signup } from '../api/client'
import WakingNotice from '../components/WakingNotice'
import { Logo, Spinner } from '../components/ui'

const HAS_ACCOUNT = 'has_account'
const knownHere = () => { try { return localStorage.getItem(HAS_ACCOUNT) === '1' } catch { return false } }

// What a scan looks like, from a real AAPL scan on Oct 15, 2026 (static: it shows before the server answers)
function SampleScan() {
  return (
    <section aria-labelledby="sample-h" className="mt-6 rounded-card bg-surface p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="sample-h" className="text-13 font-semibold text-fg-2">What a scan looks like</h2>
        <span className="text-12 text-muted">Sample · 300 AAPL</span>
      </div>
      <div className="mt-2.5 text-15 text-fg-2">Sell 3 calls, collect about</div>
      <div className="hero-num">$585</div>
      <div className="mt-1 text-15 font-semibold">3 × $355 call · expires Oct 30</div>
      <p className="mt-3 border-t border-line pt-3 text-13 text-fg-2">
        <strong className="font-semibold text-fg">The catch:</strong> if AAPL closes above $355 on Oct 30, your 300 shares are sold
        at $355. That has about a 22% chance. Otherwise you keep the $585 and your shares.
      </p>
      <p className="mt-2 text-12 text-muted">From a real scan on Oct 15. Yours uses today's prices and your own shares.</p>
    </section>
  )
}

export default function LoginPage({ canClaim, startWithLogin = false, onLoggedIn }) {
  const [mode, setMode]         = useState(() => (startWithLogin || knownHere() ? 'login' : 'signup'))
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [claim, setClaim]       = useState('')
  const [code, setCode]         = useState('')      // recovery code (mode 'recover')
  const [shown, setShown]       = useState(false)
  const [busy, setBusy]         = useState(false)
  const [error, setError]       = useState(null)
  const signingUp = mode === 'signup'
  const recovering = mode === 'recover'
  useEffect(() => {
    document.title = `${signingUp ? 'Create an account' : recovering ? 'Set a new password' : 'Log in'} · CovCall`
  }, [signingUp, recovering])

  const switchTo = m => { setMode(m); setError(null) }

  const submit = async (e) => {
    e.preventDefault()
    if (!email.trim() || !password || (recovering && !code.trim())) {
      setError(recovering ? 'Enter your email, recovery code and a new password.' : 'Enter your email and password.')
      return
    }
    setBusy(true); setError(null)
    try {
      const r = signingUp ? await signup(email, password, claim || null)
        : recovering ? await recover(email, code, password)
          : await login(email, password)
      setToken(r.data.token)
      try { localStorage.setItem(HAS_ACCOUNT, '1') } catch { /* storage unavailable */ }
      onLoggedIn(r.data, mode)
    } catch (err) {
      setError(apiError(err, "Couldn't reach the server. Try again in a moment."))
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-12">
      <form className="page flex w-full max-w-[380px] flex-col" onSubmit={submit} aria-labelledby="auth-h" noValidate>
        <Logo size={44} />
        <h1 id="auth-h" className="mt-6 font-display text-28 font-medium">
          {signingUp ? 'Get paid for shares you already own' : recovering ? 'Set a new password' : 'Log in to CovCall'}
        </h1>
        <p className="mt-2.5 text-15 text-fg-2">
          {signingUp
            ? 'CovCall finds a covered call for your stocks and tells you when to close it. You place the trades at your own broker.'
            : recovering
              ? 'Use the recovery code you saved when you made your account. Every other device is logged out.'
              : 'Welcome back. Your stocks and calls are where you left them.'}
        </p>
        {signingUp && <SampleScan />}

        {signingUp && <h2 className="mt-8 text-17 font-semibold">Create your account</h2>}
        <label className={`label ${signingUp ? 'mt-3' : 'mt-8'}`} htmlFor="auth-email">Email</label>
        <input id="auth-email" className="input" type="email" autoComplete="email" inputMode="email" autoFocus={!signingUp}
          placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} aria-invalid={error ? true : undefined} />

        {recovering && (
          <>
            <label className="label mt-4" htmlFor="auth-code">Recovery code</label>
            <input id="auth-code" className="input font-mono tracking-[0.04em]" type="text" autoComplete="off" autoCapitalize="characters"
              spellCheck={false} placeholder="XXXX-XXXX-XXXX-XXXX" value={code} onChange={e => setCode(e.target.value)}
              aria-invalid={error ? true : undefined} />
          </>
        )}

        <span className="mt-4 flex items-baseline justify-between gap-3">
          <label className="label mb-0" htmlFor="auth-password">{recovering ? 'New password' : 'Password'}</label>
          {mode === 'login' && <button type="button" className="link link-quiet text-13" onClick={() => switchTo('recover')}>Forgot password?</button>}
        </span>
        <span className="relative block">
          <input id="auth-password" className="input mt-1.5 pr-14" type={shown ? 'text' : 'password'}
            autoComplete={signingUp || recovering ? 'new-password' : 'current-password'} placeholder={signingUp || recovering ? 'At least 10 characters' : ''}
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
          {busy ? <><Spinner /> {signingUp ? 'Creating your account…' : 'Checking…'}</>
            : signingUp ? 'Create account' : recovering ? 'Set password and log in' : 'Log in'}
        </button>
        {recovering ? (
          <>
            <p className="mt-3 text-13 text-muted">No code? CovCall doesn't have your email address for messages, so there's no other way back in. That's why the code matters.</p>
            <p className="mt-4 text-center text-15 text-fg-2">
              Remembered it? <button type="button" className="link" onClick={() => switchTo('login')}>Log in</button>
            </p>
          </>
        ) : (
          <p className="mt-4 text-center text-15 text-fg-2">
            {signingUp ? 'Already have an account? ' : 'New to CovCall? '}
            <button type="button" className="link" onClick={() => switchTo(signingUp ? 'login' : 'signup')}>
              {signingUp ? 'Log in' : 'Create an account'}
            </button>
          </p>
        )}

        <WakingNotice variant="box" className="mt-6" />

        <ul className="mt-10 flex flex-col gap-2.5 border-t border-line pt-5 text-13 text-muted">
          <li className="flex gap-2.5"><LockKeyhole size={16} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />Your stocks and trades are private to your account.</li>
          <li className="flex gap-2.5"><ShieldCheck size={16} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />CovCall never connects to your broker or places orders.</li>
        </ul>
      </form>
    </div>
  )
}
