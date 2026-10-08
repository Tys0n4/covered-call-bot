// src/components/PriceStamp.jsx — one quiet line: when option prices were checked,
// and whether they're last-close prices because the market is shut.
import { Dot } from './ui'

const time = iso => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
const opens = iso => new Date(iso).toLocaleString('en-US', { weekday: 'long', hour: 'numeric', minute: '2-digit' })

// meta: { checked_at, market_open, next_market_open, quotes_live_at, data_source } from /manage
export default function PriceStamp({ meta, className = '' }) {
  if (!meta?.checked_at) return null
  const text = meta.quotes_live_at
    ? `Trading just opened. Prices are 15 minutes behind, so these are last-close prices until ${time(meta.quotes_live_at)}.`
    : !meta.market_open
      ? `Market closed · last-close prices${meta.next_market_open ? ` until ${opens(meta.next_market_open)}` : ''}`
      : `Prices checked ${time(meta.checked_at)}${meta.data_source === 'yahoo' ? ' from Yahoo (Cboe was unavailable)' : ''}`
  return (
    <p className={`flex items-center gap-2 text-12 text-muted ${className}`}>
      <Dot tone={meta.market_open && !meta.quotes_live_at ? 'accent' : undefined} />{text}
    </p>
  )
}
