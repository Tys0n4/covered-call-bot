// src/components/RecommendedTrade.jsx — the Scanner's answer for one stock: the call that fits
// your rules (shown, with the rules) for every free contract, what you collect at the middle
// price, whether it keeps your goal's pace (it never goes outside your rules to), the catch in
// plain words with the tax if your shares are sold (taxable or retirement account), the order
// to place at your broker with the bid and ask to check, the alternative with more room to
// rise, and a box to record what your broker filled (any time; the "use the quote" shortcut
// only while prices are live).
import { Link } from 'react-router-dom'
import { ArrowRight, Check, ChevronRight, Copy } from 'lucide-react'
import { useToast } from '../context/ToastContext'
import { GoalCheck, PremiumTip } from './PremiumCheck'
import { eventsText } from '../lib/events'
import { Dot, MoneyField, Spinner } from './ui'
import { fmtDate, money, plural, strike } from '../lib/format'
import { moneyValue } from '../lib/pnl'

const chanceOf = o => (o?.delta != null ? Math.round(o.delta * 100) : null)
const usd = v => money(v, 0)
const WIDE_SPREAD = 8   // percent of the price: above this, fills usually come in under the middle

function premiumLine(check, ticker) {
  if (!check) return null
  return {
    rich: `Options are paying more than usual for ${ticker} right now`,
    normal: `Premiums are about normal for ${ticker}`,
    thin: `Premiums are thin for ${ticker} right now; waiting may pay more`,
  }[check.level]
}

// "First sentence. Rest." -> the first sentence, for the short event lines
const firstSentence = text => /^(.+?[.!?])(\s|$)/.exec(text)?.[1] || text

// If your shares are sold: the gain (or loss) over what you paid, as the tax sees it
function TaxBox({ trade, avgCost, account, onAccount }) {
  const shares = trade.contracts * 100
  const gain = avgCost > 0 ? (trade.strike - avgCost) * shares : null
  const retirement = account === 'retirement'
  let text
  if (retirement) {
    text = "In an IRA or other retirement account there's no tax when they're sold."
  } else if (gain == null) {
    text = "Add what you paid for the shares (Home, the stock's ⋯ menu) to see the gain."
  } else if (gain >= 0) {
    text = `A gain of about ${usd(gain)} over the ${money(avgCost)} you paid. Held more than a year, it's usually taxed at the lower long-term rate; some calls can reset that clock. An estimate, not tax advice.`
  } else {
    text = `About ${usd(-gain)} less than the ${money(avgCost)} you paid, a loss that can usually offset gains. An estimate, not tax advice.`
  }
  return (
    <div className="mt-3.5 rounded-sm bg-inset px-4 py-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="whitespace-nowrap text-13 font-semibold">If your shares are sold</span>
        <span className="whitespace-nowrap text-12 text-muted">
          {retirement ? 'Retirement account' : 'Taxable account'} ·{' '}
          <button type="button" className="link link-quiet text-12" onClick={() => onAccount?.(retirement ? 'taxable' : 'retirement')}
            aria-label={retirement ? 'Change to a taxable account' : 'Change to a retirement account (IRA)'}>change</button>
        </span>
      </div>
      <p className="mt-1 text-13 text-fg-2">{text}</p>
    </div>
  )
}

function OrderBox({ ticker, trade, option, live, nextOpen }) {
  const toast = useToast()
  const text = `Sell to open ${plural(trade.contracts, 'contract')} · ${ticker} ${fmtDate(trade.expiry)} ${strike(trade.strike)} call · limit ${money(trade.entry_price)}`
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); toast('Order copied') } catch { toast(text) }
  }
  const quotes = option?.bid > 0 && option?.ask > 0 ? `the ${money(option.bid)} bid and ${money(option.ask)} ask` : null
  return (
    <section aria-labelledby="order-h" className="mt-3 rounded-card border border-edge p-5">
      <h3 id="order-h" className="text-13 font-medium text-fg-2">If you decide to sell, the order at your broker</h3>
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
          ? quotes
            ? `${money(trade.entry_price)} is the middle of ${quotes}, about 15 minutes ago. Check both at your broker first: if the bid has dropped, lower the limit or wait.`
            : 'Prices are about 15 minutes behind. Check the price at your broker before you send it.'
          : `This is the last close${quotes ? ` (${quotes})` : ''}. Check the bid and ask at your broker once the market opens${nextOpen ? ` (${nextOpen})` : ''}.`}
      </p>
    </section>
  )
}

// When no call within your rules keeps the goal's pace: say so, and that it won't take more risk to
function ShortOfGoal({ check, ticker, contracts }) {
  return (
    <div role="note" className="mt-4 flex gap-2.5 rounded-card border border-edge px-4 py-3.5 text-13 text-fg-2">
      <Dot tone="amber" className="mt-1.5" />
      <span>
        <strong className="font-semibold text-fg">Short of your {usd(check.goal)} goal.</strong>{' '}
        To keep pace, {ticker}'s {plural(contracts, 'contract')} would need about {usd(check.pace_per_contract * contracts)} a month
        after buying back; the best call within your rules brings about {usd(check.plan_per_contract * contracts)} a month. CovCall stays within
        your rules instead of picking a riskier call to reach a goal.
      </span>
    </div>
  )
}

export default function RecommendedTrade({
  result, useAlt, onToggleAlt, fill, fees, showFees, saved, saving, onFill, onFees, onSave, lastPrices, nextOpen,
  taxAccount = 'taxable', onTaxAccount,
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
  const goal = trade === main ? result.goal_check : null
  const wide = o.spread_pct != null && o.spread_pct >= WIDE_SPREAD
  // The API's notes are about the recommended call; the alternative gets a short line from its own dates
  const notes = trade === main ? (result.event_notes || []).map(firstSentence) : (eventsText(o, ticker) ? [`It expires ${eventsText(o, ticker)}.`] : [])
  const fillValue = moneyValue(fill)
  const feesValue = moneyValue(fees) || 0
  const fillOk = fillValue != null && fillValue > 0
  const rules = result.delta_min != null && result.delta_max != null
    ? [`Your rules: about a ${Math.round(result.delta_min * 100)}–${Math.round(result.delta_max * 100)}% chance of selling`, `${result.min_dte}–${result.max_dte} days`]
    : []

  return (
    <>
      <section aria-labelledby="rec-h" className="mt-6">
        {rules.length > 0 && (
          <div className="mb-3.5 flex flex-wrap gap-1.5">
            {rules.map(r => <Link key={r} to="/strategy" className="inline-flex min-h-7 items-center rounded-full bg-surface px-2.5 text-12 font-medium text-fg-2 hover:text-fg">{r}</Link>)}
          </div>
        )}
        <h2 id="rec-h" className="text-15 font-medium text-fg-2">
          {lastPrices ? 'At the last close, ' : ''}{trade === main ? (lastPrices ? 'the call that fits your rules' : 'The call that fits your rules') : (lastPrices ? 'with more room to rise' : 'With more room to rise')}:
          sell {plural(trade.contracts, 'call')}, collect about
        </h2>
        <div className="hero-num mt-1">{usd(trade.premium_total)}</div>
        <div className="mt-2 text-17 font-semibold">{trade.contracts} × {strike(trade.strike)} call · expires {fmtDate(trade.expiry)}</div>
        <div className="mt-0.5 text-13 text-muted">
          {plural(o.dte ?? 0, 'day')} · if it fills at the middle price{wide ? '; this one trades thinly, so it often fills a little lower' : ''}
        </div>
        {(line || (goal && goal.met)) && (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-13 text-muted">
            {line && <span>{line} <PremiumTip check={result.premium_check} /></span>}
            {line && goal?.met && <span aria-hidden="true">·</span>}
            {goal?.met && <GoalCheck check={goal} deltaMax={result.delta_max} />}
          </div>
        )}
      </section>

      {goal && !goal.met && <ShortOfGoal check={goal} ticker={ticker} contracts={trade.contracts} />}

      <section aria-labelledby="catch-h" className="mt-5 rounded-card bg-surface p-5">
        <h3 id="catch-h" className="text-15 font-semibold">The catch</h3>
        <p className="mt-1.5 text-15 text-fg-2">
          If {ticker} closes above <strong className="font-semibold text-fg">{strike(trade.strike)}</strong> on {fmtDate(trade.expiry)}, your {shares.toLocaleString()} shares
          are sold at {strike(trade.strike)}.{chance != null && <> That has about a <strong className="font-semibold text-fg">{chance}% chance</strong>.</>}
        </p>
        <p className="mt-2 text-15 text-fg-2">Otherwise you keep the {usd(trade.premium_total)} and your shares.</p>
        <TaxBox trade={trade} avgCost={result.avg_cost} account={taxAccount} onAccount={onTaxAccount} />
        {notes.map((n, i) => (
          <p key={i} className="mt-2.5 flex gap-2 text-13 text-fg-2"><Dot tone="amber" className="mt-1.5" />{n}</p>
        ))}
      </section>

      <OrderBox ticker={ticker} trade={trade} option={o} live={!lastPrices} nextOpen={nextOpen} />

      {other && (
        <button type="button" className="mt-3 flex w-full items-center justify-between gap-3 border-y border-line py-3 text-left" onClick={onToggleAlt}>
          <span>
            <span className="block text-13 text-muted">{useAlt ? 'Or the call that fits your rules best' : 'Or keep more room to rise'}</span>
            <span className="block text-15 font-semibold">
              {other.contracts} × {strike(other.strike)} call · about {usd(other.premium_total)}
              {chanceOf(optionFor(other)) != null ? ` · ${chanceOf(optionFor(other))}% chance` : ''}
            </span>
          </span>
          <ChevronRight size={16} strokeWidth={2} className="shrink-0 text-muted" aria-hidden="true" />
        </button>
      )}

      <section aria-labelledby="record-h" className="mt-6 rounded-card bg-surface p-5">
        {saved ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="inline-flex items-center gap-2 text-17 font-semibold"><Check size={20} strokeWidth={2.4} className="text-fg-2" /> Saved</span>
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
