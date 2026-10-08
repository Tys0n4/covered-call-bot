// src/components/OptionsTable.jsx — every option that matched the Scanner filters.
// Grouped by expiry by default (heads-ups about earnings / the Fed show once per
// group); click a column header to sort the whole list by it instead.
import { useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import InfoTip from './InfoTip'
import { Dot } from './ui'
import { TERMS } from '../lib/terms'
import { fmtDate, money, pct, plural, strike } from '../lib/format'

const COLUMNS = [
  { key: 'strike',               label: 'Strike',        first: 'asc' },
  { key: 'premium_price',        label: 'Premium',       tip: TERMS.fillPrice, first: 'desc' },
  { key: 'annualized_yield_pct', label: 'Yearly return', tip: TERMS.yield,   first: 'desc' },
  { key: 'upside_to_strike_pct', label: 'Room to rise',  tip: TERMS.upside,  first: 'desc' },
  { key: 'delta',                label: 'Chance called', tip: TERMS.delta,   first: 'asc' },
  { key: 'spread_pct',           label: 'Spread',        tip: TERMS.spread,  first: 'asc' },
]

// What comes before expiry, in words: "after AMZN earnings and the Fed decision"
// eslint-disable-next-line react-refresh/only-export-components
export function eventsText(o, ticker) {
  const parts = []
  if (o.spans_earnings) parts.push(`${ticker ? `${ticker} ` : ''}earnings`)
  if (o.spans_fed) parts.push('the Fed decision')
  if (o.spans_industry) parts.push('industry earnings')
  if (o.spans_ex_dividend) parts.push('the ex-dividend date')
  if (!parts.length) return null
  return `after ${parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0]}`
}

function QuoteNote({ c }) {
  if (c.quote_quality === 'LIVE') return null
  const text = c.quote_quality === 'OLD' ? 'old price' : c.quote_quality === 'STALE' && c.price_basis === 'closing' ? 'closing' : c.quote_quality === 'STALE' ? 'last trade' : c.quote_quality.toLowerCase()
  const tip = c.quote_quality === 'OLD' ? `${TERMS.oldPrice}${c.last_trade_date ? ` Last traded ${fmtDate(c.last_trade_date)}.` : ''}` : c.price_basis === 'closing' ? TERMS.closingQuote : TERMS.lastTrade
  return <span className="ml-1.5 text-12 text-muted" title={tip}>{text}</span>
}

function SortHeader({ col, sort, onSort, num = true }) {
  const active = sort.key === col.key
  const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown
  return (
    <th className={num ? 'num' : ''} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <span className="inline-flex items-center gap-1">
        <button type="button" className={`inline-flex items-center gap-1 ${active ? 'text-fg' : 'hover:text-fg'}`} onClick={() => onSort(col)}>
          {col.label} <Icon size={12} strokeWidth={2.25} className={active ? 'text-accent' : 'opacity-50'} aria-hidden="true" />
        </button>
        {col.tip && <InfoTip text={col.tip} size={12} />}
      </span>
    </th>
  )
}

function Cells({ c, picked }) {
  return <>
    <td className="font-semibold" title={c.below_cost_basis ? 'Below your average cost' : undefined}>
      <span style={{ color: c.below_cost_basis ? 'var(--amber)' : undefined }}>{strike(c.strike)}</span>
      {picked && <span className="ml-2 text-13 font-semibold text-accent">{picked}</span>}
      {c.below_cost_basis && <span className="ml-2 text-12 font-medium text-amber">below your cost</span>}
    </td>
    <td className="num">{money(c.premium_price)}<QuoteNote c={c} /></td>
    <td className="num">{pct(c.annualized_yield_pct)}</td>
    <td className="num">{pct(c.upside_to_strike_pct)}</td>
    <td className="num">{c.delta != null ? `${Math.round(c.delta * 100)}%` : '—'}</td>
    <td className="num text-fg-2">{pct(c.spread_pct)}</td>
  </>
}

const EXPIRY = { key: 'expiry', label: 'Expires', first: 'asc' }

// picked: Map of "expiry|strike" -> "Income" / "Balanced" for the recommended calls
export default function OptionsTable({ candidates, ticker, picked = new Map() }) {
  const [sort, setSort] = useState({ key: 'expiry', dir: 'asc' })
  const onSort = col => setSort(s => (s.key === col.key
    ? { key: col.key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
    : { key: col.key, dir: col.first }))

  const grouped = sort.key === 'expiry'
  const span = COLUMNS.length + (grouped ? 0 : 2)
  const pick = c => picked.get(`${c.expiry}|${c.strike}`)

  const sign = sort.dir === 'asc' ? 1 : -1
  const rows = candidates.slice().sort((a, b) => {
    if (grouped) return sign * a.expiry.localeCompare(b.expiry) || a.strike - b.strike
    const av = a[sort.key], bv = b[sort.key]
    if (av == null || bv == null) return (av == null) - (bv == null)   // blanks last
    return sign * (av - bv) || a.expiry.localeCompare(b.expiry)
  })

  // Expiry groups, in the sorted order
  const groups = []
  if (grouped) {
    for (const c of rows) {
      const g = groups[groups.length - 1]
      if (g && g.expiry === c.expiry) g.items.push(c)
      else groups.push({ expiry: c.expiry, dte: c.dte, items: [c] })
    }
  }

  return (
    <>
      <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <table className="dtable min-w-[600px]">
          <thead>
            <tr>
              {!grouped && <SortHeader col={EXPIRY} sort={sort} onSort={onSort} num={false} />}
              {!grouped && <th className="num">Days</th>}
              {COLUMNS.map((col, i) => <SortHeader key={col.key} col={col} sort={sort} onSort={onSort} num={i > 0} />)}
            </tr>
          </thead>
          <tbody>
            {grouped ? groups.map(g => {
              const ev = eventsText(g.items[0], ticker)
              return [
                <tr key={g.expiry}>
                  <td colSpan={span} className="pt-6 pb-2 text-13 font-semibold text-fg-2">
                    <button type="button" className="hover:text-fg" onClick={() => onSort(EXPIRY)}
                      title={sort.dir === 'asc' ? 'Show latest expiry first' : 'Show soonest expiry first'}>
                      {fmtDate(g.expiry)} · {plural(g.dte, 'day')}
                    </button>
                    {ev && <span className="ml-3 inline-flex items-center gap-1.5 font-medium"><Dot tone="amber" />{ev}</span>}
                  </td>
                </tr>,
                ...g.items.map(c => <tr key={`${c.expiry}-${c.strike}`}><Cells c={c} picked={pick(c)} /></tr>),
              ]
            }) : rows.map(c => (
              <tr key={`${c.expiry}-${c.strike}`}>
                <td>
                  <span className="inline-flex items-center gap-1.5">{fmtDate(c.expiry)}{eventsText(c) && <span title={eventsText(c, ticker)}><Dot tone="amber" /></span>}</span>
                </td>
                <td className="num text-fg-2">{c.dte}</td>
                <Cells c={c} picked={pick(c)} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-12 text-muted">
        Premium is the midpoint, where sell orders usually fill. Calls that expire after earnings are only picked near the low end of your range.
      </p>
    </>
  )
}
