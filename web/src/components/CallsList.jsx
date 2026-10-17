// src/components/CallsList.jsx — every call that fit the rules and filters, in plain words:
// what it pays for your contracts, the chance your shares are sold, how far the stock can
// rise first, and how easily it fills. By date (with the events before each expiry), by
// most a month, or by least chance of selling.
import { useState } from 'react'
import { Dot } from './ui'
import { TERMS } from '../lib/terms'
import { eventsText } from '../lib/events'
import { fmtDate, money, plural, strike } from '../lib/format'

const DAYS_PER_MONTH = 30.4
const SORTS = [['date', 'By date'], ['month', 'Most a month'], ['safe', 'Least chance of selling']]

// How easily a sell order fills near the middle price, from the gap between bid and ask
function fillText(spread) {
  if (spread == null) return null
  if (spread < 8) return { text: 'Easy to fill near this price', tone: 'text-muted' }
  if (spread < 12) return { text: 'Price gap a bit wide: may fill a little lower', tone: 'text-fg-2' }
  return { text: 'Wide price gap: likely to fill lower', tone: 'text-amber' }
}

// Not a live quote: say what the price is
function quoteNote(c) {
  if (c.quote_quality === 'LIVE') return null
  if (c.quote_quality === 'OLD') return { text: 'old price', tip: `${TERMS.oldPrice}${c.last_trade_date ? ` Last traded ${fmtDate(c.last_trade_date)}.` : ''}` }
  if (c.price_basis === 'closing') return { text: 'last close', tip: TERMS.closingQuote }
  return { text: 'last trade', tip: TERMS.lastTrade }
}

function Row({ c, ticker, contracts, picked, showDate }) {
  const collect = c.premium_price * 100 * contracts
  const perMonth = c.dte > 0 ? (collect / c.dte) * DAYS_PER_MONTH : null
  const fill = fillText(c.spread_pct)
  const note = quoteNote(c)
  const ev = showDate ? eventsText(c, ticker) : null
  return (
    <li className="flex gap-3 border-b border-line py-3.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-17 font-semibold">{strike(c.strike)} call</span>
          {picked && <span className="rounded-full bg-chip px-2 py-0.5 text-12 font-semibold text-on-chip">{picked}</span>}
          {c.below_cost_basis && <span className="text-12 font-medium text-amber">below what you paid</span>}
        </div>
        <div className="mt-0.5 text-13 text-fg-2">
          {showDate && <>{fmtDate(c.expiry)} · {plural(c.dte, 'day')} · </>}
          {c.delta != null ? `${Math.round(c.delta * 100)}% chance your shares are sold · ` : ''}
          {ticker} can rise {c.upside_to_strike_pct.toFixed(1)}% first
        </div>
        {ev && <div className="flex items-center gap-1.5 text-13 text-fg-2"><Dot tone="amber" />Expires {ev}</div>}
        {fill && <div className={`text-13 ${fill.tone}`}>{fill.text}</div>}
      </div>
      <div className="shrink-0 text-right">
        <div className="text-17 font-semibold">{money(collect, 0)}</div>
        {perMonth != null && <div className="text-12 text-muted">{money(perMonth, 0)} a month</div>}
        {note && <div className="text-12 text-muted" title={note.tip}>{note.text}</div>}
      </div>
    </li>
  )
}

// candidates: the scan's calls; contracts: how many the amounts are for; price: the stock now;
// picked: Map of "expiry|strike" -> a label ("Picked") for the recommended call
export default function CallsList({ candidates, ticker, contracts, price, picked = new Map() }) {
  const [sort, setSort] = useState('date')
  const n = Math.max(contracts || 1, 1)
  const pick = c => picked.get(`${c.expiry}|${c.strike}`)
  const month = c => (c.dte > 0 ? c.premium_price / c.dte : 0)

  let groups
  if (sort === 'date') {
    groups = []
    for (const c of candidates.slice().sort((a, b) => a.expiry.localeCompare(b.expiry) || a.strike - b.strike)) {
      const g = groups[groups.length - 1]
      if (g && g.expiry === c.expiry) g.items.push(c)
      else groups.push({ expiry: c.expiry, dte: c.dte, events: eventsText(c, ticker), items: [c] })
    }
  } else {
    const items = candidates.slice().sort(sort === 'month'
      ? (a, b) => month(b) - month(a)
      : (a, b) => (a.delta ?? 1) - (b.delta ?? 1) || month(b) - month(a))
    groups = [{ expiry: null, items }]
  }

  return (
    <div>
      <p className="text-13 text-fg-2">
        For your {plural(n, 'contract')}, at the middle price. The pick is the call with the least chance of selling
        your shares that still keeps your pace.
      </p>
      <div role="group" aria-label="Sort the calls" className="mt-3 flex flex-wrap gap-1.5">
        {SORTS.map(([id, label]) => (
          <button key={id} type="button" aria-pressed={sort === id} onClick={() => setSort(id)}
            className={`min-h-9 rounded-full border px-3.5 text-13 font-semibold ${sort === id ? 'border-fg bg-fg text-bg' : 'border-edge text-fg-2 hover:text-fg'}`}>
            {label}
          </button>
        ))}
      </div>
      {groups.map(g => (
        <section key={g.expiry || 'all'} aria-label={g.expiry ? `Expiring ${fmtDate(g.expiry)}` : SORTS.find(s => s[0] === sort)[1]} className="mt-4">
          {g.expiry && (
            <h3 className="flex flex-wrap items-center gap-x-2 border-b border-line pb-2 text-13">
              <span className="font-semibold">{fmtDate(g.expiry)} · {plural(g.dte, 'day')}</span>
              {g.events && <span className="inline-flex items-center gap-1.5 text-fg-2"><Dot tone="amber" />{g.events}</span>}
            </h3>
          )}
          <ul className={g.expiry ? '' : 'border-t border-line'}>
            {g.items.map(c => <Row key={`${c.expiry}|${c.strike}`} c={c} ticker={ticker} contracts={n} picked={pick(c)} showDate={!g.expiry} />)}
          </ul>
        </section>
      ))}
      <p className="mt-3 text-12 text-muted">
        "Can rise first": how far {ticker}{price ? ` (${money(price)})` : ''} can climb before the strike. "A month": what the call pays,
        spread over its days. Prices are about 15 minutes behind.
      </p>
    </div>
  )
}
