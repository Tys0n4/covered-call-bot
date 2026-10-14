// src/context/TickerContext.jsx
import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { getPortfolio } from '../api/client'

const TickerContext = createContext(null)

export function TickerProvider({ children }) {
  const [tickers, setTickers]   = useState([])
  const [loaded, setLoaded]     = useState(false)   // first load finished
  const [loadError, setLoadError] = useState(false) // last load failed (API unreachable)
  const [selected, setSelected] = useState(
    () => localStorage.getItem('selected_ticker') || null
  )

  // Use a fresh portfolio list (after loading, adding, editing or removing a stock).
  // Keeps the current selection if that stock still exists, otherwise picks the first.
  const applyPortfolio = useCallback((list) => {
    setTickers(list)
    setLoaded(true)
    setLoadError(false)
    setSelected(cur => (cur && list.some(t => t.ticker === cur)) ? cur : (list[0]?.ticker ?? null))
  }, [])

  // Asking again while a load is on its way shares it. maxAge (ms) reuses a load that
  // finished that recently: Home asks on every visit, just after the app's first load.
  const loading = useRef(null)
  const last = useRef({ at: 0, list: null })
  const refresh = useCallback(({ maxAge = 0 } = {}) => {
    if (maxAge > 0 && last.current.list && Date.now() - last.current.at < maxAge) return Promise.resolve(last.current.list)
    loading.current ??= getPortfolio()
      .then(r => { applyPortfolio(r.data); last.current = { at: Date.now(), list: r.data }; return r.data })
      .catch(e => { setLoaded(true); setLoadError(true); throw e })
      .finally(() => { loading.current = null })
    return loading.current
  }, [applyPortfolio])

  useEffect(() => { refresh().catch(() => {}) }, [refresh])

  const selectTicker = (ticker) => {
    setSelected(ticker)
    localStorage.setItem('selected_ticker', ticker)
  }

  return (
    <TickerContext.Provider value={{ tickers, selected, selectTicker, applyPortfolio, refresh, loaded, loadError }}>
      {children}
    </TickerContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export const useTicker = () => useContext(TickerContext)
