// src/pages/Login.jsx — password screen, shown when the API has APP_PASSWORD set
import { useEffect, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { apiError, login, setToken } from '../api/client'
import { Logo, Spinner } from '../components/ui'

export default function LoginPage({ onLoggedIn }) {
  const [password, setPassword] = useState('')
  const [shown, setShown]       = useState(false)
  const [busy, setBusy]         = useState(false)
  const [error, setError]       = useState(null)
  useEffect(() => { document.title = 'Log in · CovCall' }, [])

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
    <div className="flex min-h-screen items-center justify-center px-6 py-12">
      <form className="page w-full max-w-[360px]" onSubmit={submit} aria-labelledby="login-h">
        <div className="flex items-center gap-3">
          <Logo size={44} />
          <span className="text-20 font-semibold tracking-title">CovCall</span>
        </div>
        <h1 id="login-h" className="page-title mt-10">Log in</h1>
        <p className="mt-1.5 text-15 text-fg-2">Enter the password set on your server.</p>

        <label className="label mt-7" htmlFor="password">Password</label>
        <span className="relative block">
          <input id="password" className="input pr-14" type={shown ? 'text' : 'password'} autoComplete="current-password" autoFocus
            value={password} onChange={e => setPassword(e.target.value)} aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'login-err' : undefined} />
          <button type="button" className="icon-btn absolute top-0.5 right-0.5 rounded-sm" aria-label={shown ? 'Hide password' : 'Show password'}
            aria-pressed={shown} onClick={() => setShown(s => !s)}>
            {shown ? <EyeOff size={19} strokeWidth={1.8} /> : <Eye size={19} strokeWidth={1.8} />}
          </button>
        </span>
        {error && <p id="login-err" role="alert" className="field-error">{error}</p>}

        <button type="submit" className="btn btn-primary btn-block mt-5" disabled={busy}>
          {busy ? <><Spinner /> Checking…</> : 'Log in'}
        </button>
      </form>
    </div>
  )
}
