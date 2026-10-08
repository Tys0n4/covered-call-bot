// src/context/AuthContext.jsx — asks the API whether a password is needed,
// shows the login screen when it is, and only then renders the app.
import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { AUTH_LOGOUT_EVENT, clearToken, getAuthStatus, getToken } from '../api/client'
import LoginPage from '../pages/Login'
import ServerDown from '../components/ServerDown'

const AuthContext = createContext({ authRequired: false, logout: () => {} })

export function AuthProvider({ children }) {
  // checking -> ready | login | down
  const [state, setState]               = useState('checking')
  const [authRequired, setAuthRequired] = useState(false)

  const fetchStatus = useCallback(() => {
    getAuthStatus()
      .then(r => {
        const required = !!r.data.auth_required
        setAuthRequired(required)
        setState(required && !getToken() ? 'login' : 'ready')
      })
      .catch(e => {
        // An API from before logins existed has no /auth/status: run without one
        if (e.response?.status === 404) { setAuthRequired(false); setState('ready') }
        else setState('down')
      })
  }, [])

  useEffect(() => { fetchStatus() }, [fetchStatus])
  const retry = () => { setState('checking'); fetchStatus() }

  // Any request that comes back 401 (token expired or password changed)
  useEffect(() => {
    const onLogout = () => setState('login')
    window.addEventListener(AUTH_LOGOUT_EVENT, onLogout)
    return () => window.removeEventListener(AUTH_LOGOUT_EVENT, onLogout)
  }, [])

  const logout = useCallback(() => { clearToken(); setState('login') }, [])

  if (state === 'checking') {
    return <div className="flex min-h-screen items-center justify-center text-muted"><span className="spinner h-8 w-8" /></div>
  }
  if (state === 'down') return <ServerDown onRetry={retry} fullPage />
  if (state === 'login') return <LoginPage onLoggedIn={() => setState('ready')} />

  return <AuthContext.Provider value={{ authRequired, logout }}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext)
