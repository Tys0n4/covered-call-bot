// src/context/ThemeContext.jsx — light or dark (Strategy › Appearance). "system" follows
// the device. Saved in this browser; index.html applies it before the first paint.
import { createContext, useCallback, useContext, useEffect, useState } from 'react'

const KEY = 'theme'
const ThemeContext = createContext({ preference: 'system', theme: 'dark', setPreference: () => {} })

const deviceTheme = () => (window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
const savedPreference = () => {
  try {
    const p = localStorage.getItem(KEY)
    return p === 'light' || p === 'dark' ? p : 'system'
  } catch { return 'system' }
}

export function ThemeProvider({ children }) {
  const [preference, setPref] = useState(savedPreference)
  const [device, setDevice] = useState(deviceTheme)

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: light)')
    if (!mq) return
    const onChange = () => setDevice(mq.matches ? 'light' : 'dark')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const theme = preference === 'system' ? device : preference
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#FFFFFF' : '#0A0B0D')
  }, [theme])

  const setPreference = useCallback(p => {
    setPref(p)
    try { localStorage.setItem(KEY, p) } catch { /* storage unavailable */ }
  }, [])

  return <ThemeContext.Provider value={{ preference, theme, setPreference }}>{children}</ThemeContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export const useTheme = () => useContext(ThemeContext)
