// src/components/PageHeader.jsx — page title with the ticker switcher beside it
import { useEffect } from 'react'
import { ChevronDown } from 'lucide-react'
import { useTicker } from '../context/TickerContext'

function TickerSwitcher() {
  const { tickers, selected, selectTicker } = useTicker()
  if (tickers.length === 0) return null
  if (tickers.length === 1) return <span className="ticker-pill">{tickers[0].ticker}</span>
  return (
    <label className="ticker-switch" title="Switch stock">
      <select value={selected || ''} onChange={e => selectTicker(e.target.value)} aria-label="Switch stock">
        {tickers.map(t => <option key={t.ticker} value={t.ticker}>{t.ticker}</option>)}
      </select>
      <ChevronDown size={15} strokeWidth={2.25} />
    </label>
  )
}

export default function PageHeader({ title, subtitle, showTicker = false, actions }) {
  // Name the browser tab after the page, so tabs, history and bookmarks differ
  useEffect(() => { document.title = `${title} · CovCall` }, [title])
  return (
    <div className="page-header">
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6, flexWrap: 'wrap' }}>
          <h1 className="page-title">{title}</h1>
          {showTicker && <TickerSwitcher />}
        </div>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {actions && <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>{actions}</div>}
    </div>
  )
}
