// src/components/ScanAll.jsx — the Scanner's "All stocks": the recommended trade for every
// stock with contracts to sell, most premium first, and what selling them all would collect.
// Picking a stock opens its full scan, where you record what your broker filled.
import { Check, ChevronRight } from 'lucide-react'
import { Dot } from './ui'
import { eventsText } from './OptionsTable'
import { fmtDate, money, plural, strike } from '../lib/format'

const LEVEL = { rich: 'premiums rich', normal: 'premiums normal', thin: 'premiums thin' }
const firstSentence = text => /^(.+?[.!?])(\s|$)/.exec(text)?.[1] || text

// "21–23% chance of being called", from the picked options
function chance(options) {
  const d = options.map(o => o.delta).filter(v => v != null).map(v => Math.round(v * 100))
  if (!d.length) return null
  const lo = Math.min(...d), hi = Math.max(...d)
  return `${lo === hi ? lo : `${lo}–${hi}`}% chance of being called`
}

// The planned calls as one line: "3 × $200 call · 1 × $202.50 call", the same option counted once
function tradeText(planned) {
  const same = new Map()
  planned.forEach(p => {
    const k = `${p.expiry}|${p.strike}`
    same.set(k, { strike: p.strike, contracts: (same.get(k)?.contracts || 0) + p.contracts })
  })
  return [...same.values()].map(c => `${c.contracts} × ${strike(c.strike)} call`).join(' · ')
}

function StockRow({ item, saved, onReview }) {
  const r = item.result
  const planned = r?.planned_positions || []
  const options = planned.map(p => r.candidates.find(c => c.expiry === p.expiry && c.strike === p.strike) || {})
  const expiries = [...new Set(planned.map(p => p.expiry))]
  const event = options.map(o => eventsText(o, r.ticker)).find(Boolean)
  const amount = planned.length > 0 && !saved ? `+${money(r.gross_premium)}` : null

  let detail
  if (saved) {
    detail = <span className="flex items-center gap-1.5 text-15 text-fg-2"><Check size={16} strokeWidth={2.4} className="text-accent" aria-hidden="true" />Saved: every contract has a call sold</span>
  } else if (planned.length > 0) {
    detail = (
      <>
        <span className="block text-15 font-semibold max-md:text-13 max-md:font-normal max-md:text-fg-2">
          {tradeText(planned)}
        </span>
        <span className="block text-13 text-muted">
          {[expiries.map(fmtDate).join(', '), options[0]?.dte != null && plural(options[0].dte, 'day'), chance(options)].filter(Boolean).join(' · ')}
        </span>
        {event && <span className="mt-1 flex items-center gap-1.5 text-13 text-fg-2"><Dot tone="amber" />Expires {event}</span>}
      </>
    )
  } else {
    detail = (
      <>
        <span className="block text-15 text-fg-2">{r ? 'No call to sell' : "Couldn't scan"}</span>
        <span className="block text-13 text-muted">{item.error || firstSentence(r?.warnings?.[0] || 'No option passed your rules and filters.')}</span>
      </>
    )
  }

  return (
    <li className="border-b border-line">
      <button type="button" className="flex w-full items-start gap-3 py-4 text-left md:items-center md:gap-6" onClick={() => onReview(item)}>
        <span className="hidden md:block md:w-[130px] md:shrink-0">
          <span className={`block text-17 font-semibold ${amount ? '' : 'text-fg-2'}`}>{item.ticker}</span>
          <span className="block text-13 text-muted">{r ? `${money(r.current_price)} · ` : ''}{item.available} to sell</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex justify-between gap-3 md:hidden">
            <span className={`text-17 font-semibold ${amount ? '' : 'text-fg-2'}`}>{item.ticker}</span>
            {amount && <span className="text-17 font-semibold text-accent">{amount}</span>}
          </span>
          {detail}
        </span>
        {amount && (
          <span className="hidden text-right md:block">
            <span className="block text-17 font-semibold text-accent">{amount}</span>
            {r.premium_check && <span className="block text-13 text-muted">{LEVEL[r.premium_check.level]}</span>}
          </span>
        )}
        <span className="hidden shrink-0 items-center gap-1 text-13 font-semibold text-fg-2 md:inline-flex">Review <ChevronRight size={15} strokeWidth={2.2} aria-hidden="true" /></span>
        <ChevronRight size={16} strokeWidth={2} className="mt-1 shrink-0 text-muted md:hidden" aria-hidden="true" />
      </button>
    </li>
  )
}

// data: the /scan/all response; tickers: your stocks now (a stock saved since the scan shows as saved)
export default function ScanAll({ data, tickers, onReview }) {
  const savedSince = item => tickers.find(t => t.ticker === item.ticker)?.available === 0
  const trades = data.scanned.filter(i => i.result?.planned_positions.length > 0 && !savedSince(i))
  const total = trades.reduce((s, i) => s + i.result.gross_premium, 0)
  const calls = trades.reduce((s, i) => s + i.result.planned_positions.reduce((n, p) => n + p.contracts, 0), 0)
  const goals = trades.map(i => i.result.goal_check).filter(Boolean)
  const short = trades.filter(i => i.result.goal_check && !i.result.goal_check.met).map(i => i.ticker)
  const lastPrices = trades.some(i => i.result.quotes_live === false)

  return (
    <>
      <section aria-labelledby="all-total-h">
        <h2 id="all-total-h" className="text-15 font-medium text-fg-2">
          {trades.length ? `If you sell every recommended call${lastPrices ? ', at last prices' : ''}` : 'Recommended trades'}
        </h2>
        {trades.length > 0 ? (
          <>
            <div className="hero-num mt-1.5">{money(total)}</div>
            <div className="mt-2.5 text-15 text-fg-2">
              {plural(calls, 'call')} on {plural(trades.length, 'stock')}
              {goals.length > 0 && (short.length === 0
                ? <> · <span className="font-semibold text-accent">on pace for your ${Math.round(goals[0].goal).toLocaleString('en-US')} goal</span></>
                : <> · <span className="font-semibold text-amber">short of your goal pace on {short.join(', ')}</span></>)}
            </div>
          </>
        ) : (
          <p className="mt-1.5 text-22 font-semibold tracking-title">Nothing to sell right now</p>
        )}
      </section>

      {lastPrices && (
        <p className="mt-5 flex items-start gap-2 text-15 text-fg-2">
          <Dot tone="amber" className="mt-2" />
          Market closed, so these are last-close prices. Check the price at your broker once it opens.
        </p>
      )}

      <ul className="mt-6 border-t border-line">
        {data.scanned.map(item => <StockRow key={item.ticker} item={item} saved={savedSince(item)} onReview={onReview} />)}
      </ul>

      {data.covered.length > 0 && (
        <p className="mt-4 text-13 text-muted">
          {data.covered.join(', ')} {data.covered.length === 1 ? "isn't" : "aren't"} scanned: every contract already has a call sold.
        </p>
      )}
      <p className="mt-1.5 text-13 text-muted">Each stock is scanned with your rules and filters, the same as scanning it on its own. Pick one for its full scan and to record what your broker filled.</p>
    </>
  )
}
