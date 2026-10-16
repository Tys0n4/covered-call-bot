// src/components/RecommendedTrade.jsx — the Scanner's answer for one stock: one call for every
// free contract, what you collect, the catch in one plain sentence (and the tax if your shares
// are sold), the order to place at your broker, the alternative with more room to rise, and a
// box to record what your broker filled (any time; the "use the quote" shortcut only while
// prices are live).
import { Link } from 'react-router-dom'
import { ArrowRight, Check, ChevronRight, Copy } from 'lucide-react'
import { useToast } from '../context/ToastContext'
import { GoalCheck, PremiumTip } from './PremiumCheck'
import { eventsText } from './OptionsTable'
import { Dot, MoneyField, Spinner } from './ui'
import { fmtDate, money, plural, strike } from '../lib/format'
import { moneyValue } from '../lib/pnl'

const chanceOf = o => (o?.delta != null ? Math.round(o.delta * 100) : null)

function premiumLine(check, ticker) {
  if (!check) return null
  return {
    rich: `options are paying more than usual for ${ticker} right now`,
    normal: `premiums are about normal for ${ticker}`,
    thin: `premiums are thin for ${ticker} right now; waiting may pay more`,
  }[check.level]
}

// "Otherwise you keep $514 and your shares. If they are sold, ..."
function taxLine(trade, avgCost) {
  if (!(avgCost > 0)) return null
  const shares = trade.contracts * 100
  const gain = (trade.strike - avgCost) * shares
  if (gain >= 0) return `If they are sold, you'd owe tax on about ${money(gain, 0)} of gain, since you bought at ${money(avgCost)}.`
  return `If they are sold, you'd get ${money(-gain, 0)} less than you paid for them (${money(avgCost)} a share).`
}

// "First sentence. Rest." -> the first sentence, for the short event lines
const firstSentence = text => /^(.+?[.!?])(\s|$)/.exec(text)?.[1] || text

function OrderBox({ ticker, trade, live, nextOpen }) {
  const toast = useToast()
  const text = `Sell to open ${plural(trade.contracts, 'contract')} · ${ticker} ${fmtDate(trade.expiry)} ${strike(trade.strike)} call · limit ${money(trade.entry_price)}`
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); toast('Order copied') } catch { toast(text) }
  }
  return (
    <section aria-labelledby="order-h" className="mt-3 rounded-card border border-edge p-5">
      <h3 id="order-h" className="text-13 font-medium text-fg-2">Place this order at your broker</h3>
      <div className="mt-1.5 flex items-center justify-between gap-3">
        <div className="text-17 font-semibold leading-snug">
          Sell to open · {plural(trade.contracts, 'contract')}<br />
          {ticker} {fmtDate(trade.expiry)} {strike(trade.strike)} call<br />
          Limit {money(trade.entry_price)}
        </div>
        <button type="button" className="icon-btn shrink-0 border border-edge" onClick={copy} aria-label="Copy the order">
          <Copy size={17} strokeWidth={2} />
        </button>
      </div>
      <p className="mt-2 text-12 text-muted">
        {live
          ? 'Prices are about 15 minutes behind. Check the price at your broker before you send it.'
          : `This is the last close. Check the price at your broker once the market opens${nextOpen ? ` (${nextOpen})` : ''}.`}
      </p>
    </section>
  )
}

export default function RecommendedTrade({
  result, useAlt, onToggleAlt, fill, fees, showFees, saved, saving, onFill, onFees, onSave, lastPrices, nextOpen,
}) {
  const main = result.planned_positions[0]
  const trade = useAlt && result.alternative ? result.alternative : main
  const other = useAlt ? main : result.alternative
  const optionFor = p => result.candidates.find(c => c.expiry === p.expiry && c.strike === p.strike) || {}
  const o = optionFor(trade)
  const chance = chanceOf(o)
  const shares = trade.contracts * 100
  const ticker = result.ticker
  const line = premiumLine(result.premium_check, ticker)
  // The API's notes are about the recommended call; the alternative gets a short line from its own dates
  const notes = trade === main ? (result.event_notes || []).map(firstSentence) : (eventsText(o, ticker) ? [`It expires ${eventsText(o, ticker)}.`] : [])
  const fillValue = moneyValue(fill)
  const feesValue = moneyValue(fees) || 0
  const fillOk = fillValue != null && fillValue > 0

  return (
    <>
      <section aria-labelledby="rec-h" className="mt-6">
        <h2 id="rec-h" className="text-15 font-medium text-fg-2">
          {lastPrices ? 'At the last close, sell ' : 'Sell '}{plural(trade.contracts, 'call')}, collect about
        </h2>
        <div className="hero-num mt-1">{money(trade.premium_total, 0)}</div>
        <div className="mt-2 text-17 font-semibold">{trade.contracts} × {strike(trade.strike)} call · expires {fmtDate(trade.expiry)}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-13 text-muted">
          <span>{plural(o.dte ?? 0, 'day')}{line && <> · {line} <PremiumTip check={result.premium_check} /></>}</span>
          {trade === main && result.goal_check && <><span aria-hidden="true">·</span><GoalCheck check={result.goal_check} deltaMax={result.delta_max} /></>}
        </div>
      </section>

      <section aria-labelledby="catch-h" className="mt-5 rounded-card bg-surface p-5">
        <h3 id="catch-h" className="text-15 font-semibold">The catch</h3>
        <p className="mt-1.5 text-15 text-fg-2">
          If {ticker} closes above <strong className="font-semibold text-fg">{strike(trade.strike)}</strong> on {fmtDate(trade.expiry)}, your {shares.toLocaleString()} shares
          are sold at {strike(trade.strike)}.{chance != null && <> That has about a <strong className="font-semibold text-fg">{chance}% chance</strong>.</>}
        </p>
        <p className="mt-2 text-15 text-fg-2">
          Otherwise you keep the {money(trade.premium_total, 0)} and your shares.{taxLine(trade, result.avg_cost) ? ` ${taxLine(trade, result.avg_cost)}` : ''}
        </p>
        {notes.map((n, i) => (
          <p key={i} className="mt-2.5 flex gap-2 text-13 text-fg-2"><Dot tone="amber" className="mt-1.5" />{n}</p>
        ))}
      </section>

      <OrderBox ticker={ticker} trade={trade} live={!lastPrices} nextOpen={nextOpen} />

      {other && (
        <button type="button" className="mt-3 flex w-full items-center justify-between gap-3 border-y border-line py-3 text-left" onClick={onToggleAlt}>
          <span>
            <span className="block text-13 text-muted">{useAlt ? 'Or the recommended call' : 'Or keep more room to rise'}</span>
            <span className="block text-15 font-semibold">
              {other.contracts} × {strike(other.strike)} call · about {money(other.premium_total, 0)}
              {chanceOf(optionFor(other)) != null ? ` · ${chanceOf(optionFor(other))}% chance` : ''}
            </span>
          </span>
          <ChevronRight size={16} strokeWidth={2} className="shrink-0 text-muted" aria-hidden="true" />
        </button>
      )}

      <section aria-labelledby="record-h" className="mt-6 rounded-card bg-surface p-5">
        {saved ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="inline-flex items-center gap-2 text-17 font-semibold"><Check size={20} strokeWidth={2.4} className="text-accent" /> Saved</span>
            <Link to="/positions" className="btn btn-secondary btn-sm">View in Positions <ArrowRight size={15} strokeWidth={2.2} /></Link>
          </div>
        ) : (
          <>
            <h3 id="record-h" className="text-17 font-semibold">Sold it? Record what you got</h3>
            <p className="mt-1 text-13 text-fg-2">The price per share from your broker's confirmation. You can do this any time.</p>
            <div className="mt-4 flex flex-wrap items-end gap-2.5">
              <MoneyField className="min-w-0 flex-[1_1_140px]" id="fill-price" label="Sold at, per share" value={fill} onChange={onFill}
                error={fill && !fillOk ? 'Enter the price' : null} />
              {showFees && <MoneyField className="w-28" id="fill-fees" label="Fees" value={fees} onChange={onFees} />}
              <button type="button" className="btn btn-primary min-h-12 px-6" onClick={onSave} disabled={saving || !fillOk}>
                {saving ? <><Spinner /> Saving…</> : 'Save'}
              </button>
            </div>
            {fillOk ? (
              <p className="mt-3 text-13 text-fg-2">At this price you collect {money(fillValue * shares - feesValue)}{showFees ? ' after fees' : ''}.</p>
            ) : lastPrices ? (
              <p className="mt-3 text-13 text-fg-2">The market isn't open, so there's no current price to fill in. Enter what your broker filled.</p>
            ) : (
              <p className="mt-3 text-13 text-fg-2">Filled at the limit?{' '}
                <button type="button" className="link text-13" onClick={() => onFill(trade.entry_price.toFixed(2))}>Use {money(trade.entry_price)}</button>
              </p>
            )}
            <p className="mt-2 text-12 text-muted">This records the trade in CovCall so you can track it. It doesn't place an order.</p>
          </>
        )}
      </section>
    </>
  )
}
