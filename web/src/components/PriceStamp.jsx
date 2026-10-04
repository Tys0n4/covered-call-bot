// src/components/PriceStamp.jsx — when option prices were last checked, and
// whether they're from the last close because the market is shut.
import { Clock3, Moon } from 'lucide-react'
import { SOURCE_LABEL } from '../lib/source'

const time = iso => new Date(iso).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' })
const opens = iso => new Date(iso).toLocaleString('en-CA', { weekday: 'long', hour: 'numeric', minute: '2-digit' })

// meta: { checked_at, market_open, next_market_open, data_source } from /manage
export default function PriceStamp({ meta, style }) {
  if (!meta?.checked_at) return null
  const Icon = meta.market_open ? Clock3 : Moon
  return (
    <div className="hint price-stamp" style={style}>
      <Icon size={13} strokeWidth={2} aria-hidden="true" />
      <span>
        Prices checked {time(meta.checked_at)}{SOURCE_LABEL[meta.data_source] ? ` from ${SOURCE_LABEL[meta.data_source]}` : ''}
        {!meta.market_open && <> · Market closed: these are last-close prices{meta.next_market_open ? ` until it reopens (${opens(meta.next_market_open)} your time)` : ''}</>}
      </span>
    </div>
  )
}
