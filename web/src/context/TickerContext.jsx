// src/context/TickerContext.jsx
import { createContext, useContext, useState, useEffect } from 'react'
import { getPortfolio } from '../api/client'

const TickerContext = createContext(null)

export function TickerProvider({ children }) {
  const [tickers, setTickers]   = useState([])
  const [selected, setSelected] = useState(
    () => localStorage.getItem('selected_ticker') || null
  )

  useEffect(() => {
    getPortfolio().then(r => {
      setTickers(r.data)
      // Auto-select first ticker if none stored
      if (!selected && r.data.length > 0) {
        setSelected(r.data[0].ticker)
      }
    }).catch(() => {})
  }, [])

  const selectTicker = (ticker) => {
    setSelected(ticker)
    localStorage.setItem('selected_ticker', ticker)
  }

  return (
    <TickerContext.Provider value={{ tickers, selected, selectTicker }}>
      {children}
    </TickerContext.Provider>
  )
}

export const useTicker = () => useContext(TickerContext)
