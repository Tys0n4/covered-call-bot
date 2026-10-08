// src/context/MarketContext.jsx — is the stock market open? For the status in the
// header. Asked on load, every 5 minutes, and when you come back to the tab.
import { createContext, useContext, useEffect, useState } from 'react'
import { getMarket } from '../api/client'

const MarketContext = createContext({ open: null, nextOpen: null })
const EVERY = 5 * 60 * 1000

export function MarketProvider({ children }) {
  const [market, setMarket] = useState({ open: null, nextOpen: null })

  useEffect(() => {
    let live = true
    const check = () => getMarket()
      .then(r => { if (live) setMarket({ open: r.data.market_open, nextOpen: r.data.next_market_open }) })
      .catch(() => {})
    check()
    const timer = setInterval(check, EVERY)
    const onVisible = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { live = false; clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [])

  return <MarketContext.Provider value={market}>{children}</MarketContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export const useMarket = () => useContext(MarketContext)
