// src/components/OptionsTable.jsx — every option that matched the Scanner filters.
// Grouped by expiry by default (earnings / ex-dividend badges show once per
// group); click a column header to sort the whole list by it instead.
import { useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import InfoTip from './InfoTip'
import { TERMS } from '../lib/terms'
import { fmtDate, money, pct, plural } from '../lib/format'

const COLUMNS = [
  { key: 'strike',               label: 'Strike',        tip: TERMS.strike,  first: 'asc' },
  { key: 'premium_price',        label: 'Premium',       tip: TERMS.fillPrice, first: 'desc' },
  { key: 'annualized_yield_pct', label: 'Yearly return', tip: TERMS.yield,   first: 'desc' },
  { key: 'upside_to_strike_pct', label: 'Room to rise',  tip: TERMS.upside,  first: 'desc' },
  { key: 'delta',                label: 'Called chance', tip: TERMS.delta,   first: 'asc' },
  { key: 'spread_pct',           label: 'Spread',        tip: TERMS.spread,  first: 'asc' },
]

// Earnings / ex-dividend before expiry
export function EventBadges({ option, compact = false }) {
  if (compact) return <>
    {option.spans_earnings && <span className="event-mark tone-amber" title={TERMS.earnings} aria-label="Spans earnings">E</span>}
    {option.spans_ex_dividend && <span className="event-mark tone-blue" title={TERMS.exDividend} aria-label="Spans an ex-dividend date">D</span>}
  </>
  return <>
    {option.spans_earnings && <span className="badge badge-amber" title={TERMS.earnings}>Earnings</span>}
    {option.spans_ex_dividend && <span className="badge badge-blue" title={TERMS.exDividend}>Ex-div</span>}
  </>
}

function QuoteBadge({ quality }) {
  if (quality === 'LIVE') return <span className="muted">Live</span>
  return <span className={`badge badge-${quality === 'STALE' ? 'amber' : 'red'}`}>{quality === 'STALE' ? 'Stale' : quality}</span>
}

function SortHeader({ col, sort, onSort, className = 'num' }) {
  const active = sort.key === col.key
  const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown
  return (
    <th className={className} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <button type="button" className={`sort-btn${active ? ' active' : ''}`} onClick={() => onSort(col)}>
          {col.label} <Icon size={12} strokeWidth={2.25} aria-hidden="true" />
        </button>
        {col.tip && <InfoTip text={col.tip} size={12} />}
      </span>
    </th>
  )
}

function Cells({ c }) {
  return <>
    <td className="mono num" style={{ color: c.below_cost_basis ? 'var(--amber)' : 'var(--text)', fontWeight: 600 }}
      title={c.below_cost_basis ? 'Below your average cost' : undefined}>{c.below_cost_basis ? '▾ ' : ''}{money(c.strike)}</td>
    <td className="mono num" style={{ color: 'var(--accent-light)' }}>{money(c.premium_price)}</td>
    <td className="mono num">{pct(c.annualized_yield_pct)}</td>
    <td className="mono num">{pct(c.upside_to_strike_pct)}</td>
    <td className="mono num">{c.delta != null ? `${Math.round(c.delta * 100)}%` : 'n/a'}</td>
    <td className="mono num">{pct(c.spread_pct)}</td>
  </>
}

const EXPIRY = { key: 'expiry', label: 'Expires', first: 'asc' }

export default function OptionsTable({ candidates }) {
  const [sort, setSort] = useState({ key: 'expiry', dir: 'asc' })
  const onSort = col => setSort(s => (s.key === col.key
    ? { key: col.key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
    : { key: col.key, dir: col.first }))

  // Only show the quote column when some prices aren't live
  const showQuote = candidates.some(c => c.quote_quality !== 'LIVE')
  const grouped = sort.key === 'expiry'
  const hasEvents = candidates.some(c => c.spans_earnings || c.spans_ex_dividend)
  const span = COLUMNS.length + (grouped ? 0 : 2) + (showQuote ? 1 : 0)

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
    <div className="table-scroll">
      <table className="data-table options-table">
        <thead>
          <tr>
            {!grouped && <SortHeader col={EXPIRY} sort={sort} onSort={onSort} className="" />}
            {!grouped && <th className="num">Days left</th>}
            {COLUMNS.map(col => <SortHeader key={col.key} col={col} sort={sort} onSort={onSort} />)}
            {showQuote && <th>Quote <InfoTip text={TERMS.quote} size={12} /></th>}
          </tr>
        </thead>
        <tbody>
          {grouped ? groups.map(g => [
            <tr key={g.expiry} className="group-row">
              <td colSpan={span}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" className="sort-btn active" onClick={() => onSort(EXPIRY)}
                    title={sort.dir === 'asc' ? 'Show latest expiry first' : 'Show soonest expiry first'}>
                    {fmtDate(g.expiry)}
                  </button>
                  <span className="muted">{plural(g.dte, 'day')} · {plural(g.items.length, 'option')}</span>
                  <EventBadges option={g.items[0]} />
                </span>
              </td>
            </tr>,
            ...g.items.map(c => (
              <tr key={`${c.expiry}-${c.strike}`}>
                <Cells c={c} />
                {showQuote && <td><QuoteBadge quality={c.quote_quality} /></td>}
              </tr>
            )),
          ]) : rows.map(c => (
            <tr key={`${c.expiry}-${c.strike}`}>
              <td className="nowrap"><span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>{fmtDate(c.expiry)} <EventBadges option={c} compact /></span></td>
              <td className="mono num">{c.dte}</td>
              <Cells c={c} />
              {showQuote && <td><QuoteBadge quality={c.quote_quality} /></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
      <div className="hint" style={{ padding: '10px 14px 2px', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {!grouped && hasEvents && <span><span className="event-mark tone-amber">E</span> expires after earnings · <span className="event-mark tone-blue">D</span> after an ex-dividend date</span>}
        {!showQuote && <span>All prices are live quotes.</span>}
      </div>
    </>
  )
}
