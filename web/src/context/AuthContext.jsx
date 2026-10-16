// src/context/AuthContext.jsx — every portfolio belongs to an account. Shows the sign-up /
// log-in screen until there's a valid token, then the recovery code when there's a new one to
// save (after sign-up, an older account's first login, or setting a new password with a code),
// and only then renders the app.
import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { AUTH_LOGOUT_EVENT, clearToken, getAuthStatus, getMe, getToken } from '../api/client'
import LoginPage from '../pages/Login'
import RecoveryCodeScreen from '../components/RecoveryCode'
import ServerDown from '../components/ServerDown'

const AuthContext = createContext({ email: null, hasRecoveryCode: true, logout: () => {}, refreshMe: () => {} })

export function AuthProvider({ children }) {
  // checking -> ready | login | down; login -> code (a new recovery code to save) -> ready
  const [state, setState]       = useState('checking')
  const [canClaim, setCanClaim] = useState(false)   // a portfolio from before accounts that the old password can keep
  const [expired, setExpired]   = useState(false)   // logged out by the server (token expired): offer Log in first
  const [email, setEmail]       = useState(null)
  const [hasRecoveryCode, setHasRecoveryCode] = useState(true)
  const [newCode, setNewCode]   = useState(null)    // { code, kicker } to show once

  const fetchStatus = useCallback(() => {
    getAuthStatus()
      .then(r => {
        setCanClaim(!!r.data.can_claim)
        setState(getToken() ? 'ready' : 'login')
      })
      .catch(() => setState('down'))
  }, [])

  useEffect(() => { fetchStatus() }, [fetchStatus])
  const retry = () => { setState('checking'); fetchStatus() }

  // Any request that comes back 401 (token expired or not valid any more)
  useEffect(() => {
    const onLogout = () => { setExpired(true); setState('login') }
    window.addEventListener(AUTH_LOGOUT_EVENT, onLogout)
    return () => window.removeEventListener(AUTH_LOGOUT_EVENT, onLogout)
  }, [])

  // Who's logged in, and whether they have a recovery code, for the Strategy page
  const refreshMe = useCallback(() => getMe()
    .then(r => { setEmail(r.data.email); setHasRecoveryCode(r.data.has_recovery_code !== false) })
    .catch(() => {}), [])
  useEffect(() => {
    if (state === 'ready') refreshMe()
  }, [state, refreshMe])

  const loggedIn = (data, how) => {
    if (data?.recovery_code) {
      setNewCode({ code: data.recovery_code, email: data.email, kicker: how === 'signup' ? 'Account created' : how === 'recover' ? 'New password set' : 'One more thing' })
      setState('code')
    } else {
      setState('ready')
    }
  }

  // Start over from a clean page, so nothing from this account stays in memory
  const logout = useCallback(() => { clearToken(); window.location.assign('/') }, [])

  if (state === 'checking') {
    return <div className="flex min-h-screen items-center justify-center text-muted"><span className="spinner h-8 w-8" /></div>
  }
  if (state === 'down') return <ServerDown onRetry={retry} fullPage />
  if (state === 'login') return <LoginPage canClaim={canClaim} startWithLogin={expired} onLoggedIn={loggedIn} />
  if (state === 'code') {
    return <RecoveryCodeScreen code={newCode.code} email={newCode.email} kicker={newCode.kicker}
      onDone={() => { setNewCode(null); setState('ready') }} />
  }

  return <AuthContext.Provider value={{ email, hasRecoveryCode, logout, refreshMe }}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext)
