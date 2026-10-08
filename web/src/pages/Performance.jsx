// src/pages/Performance.jsx — what your covered calls actually made (see core/performance.py)
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { TrendingUp } from 'lucide-react'
import { apiError, getPerformance, getStrategy } from '../api/client'
import PageHeader from '../components/PageHeader'
import InfoTip from '../components/InfoTip'
import ServerDown from '../components/ServerDown'
import EmptyState from '../components/EmptyState'
import { PerformanceSkeleton } from '../components/Skeleton'
import { Dot, Stat } from '../components/ui'
import { fmtDate, money, pct, plural, signedMoney, strike } from '../lib/format'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const monthName = ym => MONTHS[Number(ym.slice(5, 7)) - 1]
const whole = v => `${v < 0 ? '−' : ''}$${Math.round(Math.abs(v)).toLocaleString('en-US')}`
const SHOWN = 10

const TIPS = {
  vsHolding:  'What selling calls added compared with just holding the same shares: the premium you kept after buybacks and fees, minus any gain you gave up when shares were called away below their market price that day. Bought-back calls already include any rise in the stock in their buyback cost.',
  annualized: 'Premium kept as a yearly return on the money in the shares you covered (your cost per share), weighted by how long each call was open.',
}

// Kept per month as bars (oldest first, the last 12), with your goal as a dashed line.
// Pick a bar to see how that month adds up.
function MonthBars({ months, goal, selected, onSelect, thisMonth }) {
  // Bar heights are the size of the month; a month that lost money is drawn in the loss color
  const range = Math.max(...months.map(m => Math.abs(m.option_net)), goal || 0, 1) * 1.15
  return (
    <div>
      <div className="relative flex h-[170px] items-end gap-4 border-b border-line-2 md:h-[240px] md:gap-6">
        {months.map(m => {
          const on = m.month === selected
          const h = (Math.abs(m.option_net) / range) * 100
          return (
            <button key={m.month} type="button" aria-pressed={on} onClick={() => onSelect(m.month)}
              aria-label={`${monthName(m.month)}: ${money(m.option_net)} kept`}
              className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5 md:gap-2">
              <span className={`whitespace-nowrap text-12 font-semibold md:text-13 ${on ? 'text-fg' : 'text-muted'}`}>{whole(m.option_net)}</span>
              <span className="block w-full max-w-[88px] rounded-t-sm transition-colors"
                style={{ height: `${h}%`, background: m.option_net < 0 ? 'var(--loss)' : on ? 'var(--accent)' : 'var(--accent-dim)', opacity: m.option_net < 0 && !on ? 0.5 : 1 }} />
            </button>
          )
        })}
        {goal > 0 && (
          <>
            <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 border-t-[1.5px] border-dashed border-pace" style={{ bottom: `${(goal / range) * 100}%` }} />
            <div aria-hidden="true" className="pointer-events-none absolute right-0 hidden rounded-sm bg-bg px-1 text-12 text-muted md:block" style={{ bottom: `calc(${(goal / range) * 100}% + 6px)` }}>{whole(goal)} goal</div>
          </>
        )}
      </div>
      <div className="mt-2 flex gap-4 md:gap-6" aria-hidden="true">
        {months.map(m => (
          <span key={m.month} className={`min-w-0 flex-1 truncate text-center text-13 ${m.month === selected ? 'text-fg' : 'text-muted'}`}>
            {monthName(m.month).slice(0, 3)}{m.month === thisMonth ? '*' : ''}
          </span>
        ))}
      </div>
      {goal > 0 && <div className="mt-2 flex items-center gap-1.5 text-12 text-muted md:hidden"><span className="w-3.5 border-t-[1.5px] border-dashed border-pace" />{whole(goal)} goal</div>}
    </div>
  )
}

function MonthDetail({ m, goal, thisMonth }) {
  const partial = m.month === thisMonth
  const over = m.option_net - goal
  const row = (label, value) => (
    <div className="flex justify-between gap-3 border-b border-line py-2.5"><dt className="text-fg-2">{label}</dt><dd>{value}</dd></div>
  )
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-17 font-semibold">{monthName(m.month)} {m.month.slice(0, 4)}{partial ? ', so far' : ''}</h3>
        <span className="text-13 text-muted">{plural(m.calls, 'call')} finished</span>
      </div>
      <dl className="mt-1">
        {row('Collected', money(m.premium))}
        {row('Bought back', m.buybacks ? `−${money(m.buybacks)}` : money(0))}
        {m.fees > 0 && row('Fees', `−${money(m.fees)}`)}
        <div className="flex justify-between gap-3 py-3">
          <dt className="font-semibold">Kept{m.missing_costs > 0 ? '*' : ''}</dt>
          <dd className="text-17 font-semibold" style={{ color: m.option_net < 0 ? 'var(--loss)' : 'var(--accent)' }}>{money(m.option_net)}</dd>
        </div>
        {m.share_gains ? <div className="flex justify-between gap-3 border-t border-line py-2.5"><dt className="text-fg-2">Gains on shares called away</dt><dd>{signedMoney(m.share_gains)}</dd></div> : null}
      </dl>
      {goal > 0 && (
        <p className="text-13 font-semibold" style={{ color: !partial && over >= 0 ? 'var(--accent)' : 'var(--text-2)' }}>
          {partial ? (over >= 0 ? `Goal reached: ${whole(over)} over` : `${whole(-over)} to go this month`) : over >= 0 ? `${whole(over)} over your ${whole(goal)} goal` : `${whole(-over)} short of your ${whole(goal)} goal`}
        </p>
      )}
      {m.missing_costs > 0 && <p className="mt-1 text-12 text-muted">* Leaves out {plural(m.missing_costs, 'call')} with no buyback cost entered.</p>}
    </div>
  )
}

function resultText(t) {
  if (t.status === 'EXPIRED') return 'Expired'
  if (t.status === 'ASSIGNED') return 'Called away'
  return t.rolled ? 'Rolled' : 'Bought back'
}

export default function Performance() {
  const [data, setData]       = useState(null)
  const [failed, setFailed]   = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [goal, setGoal]       = useState(0)        // monthly goal from the Strategy page (0 = off)
  const [picked, setPicked]   = useState(null)     // the month whose numbers show next to the bars
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    let cancelled = false
    getPerformance()
      .then(r => { if (!cancelled) { setData(r.data); setFailed(null) } })
      .catch(e => { if (!cancelled) setFailed(apiError(e, null) || true) })
    getStrategy().then(r => { if (!cancelled) setGoal(r.data.monthly_goal || 0) }).catch(() => {})
    return () => { cancelled = true }
  }, [reloadKey])

  const retry = () => { setFailed(null); setData(null); setReloadKey(k => k + 1) }
  const header = <PageHeader title="Performance" />

  if (failed) return <div className="page">{header}<ServerDown onRetry={retry} message={typeof failed === 'string' ? failed : undefined} /></div>
  if (!data) return <div className="page">{header}<PerformanceSkeleton /></div>

  const s = data.summary
  const year = s.month.slice(0, 4)
  // When every finished call closed this year, "this year" and "all time" are the same number
  const allThisYear = data.trades.every(t => (t.closed_at || '').startsWith(year))
  const months = data.months.slice(0, 12).reverse()
  // Show the latest full month first; this month is usually only partly done
  const defaultMonth = (months.length > 1 && months[months.length - 1].month === s.month ? months[months.length - 2] : months[months.length - 1])?.month
  const selected = months.find(m => m.month === (picked || defaultMonth))
  const trades = data.trades.slice().sort((a, b) => (b.closed_at || '').localeCompare(a.closed_at || '') || b.id - a.id)
  const shown = showAll ? trades : trades.slice(0, SHOWN)
  const anyShareGain = trades.some(t => t.share_gain)
  const v = s.vs_holding

  return (
    <div className="page">
      {header}
      {s.calls_finished === 0 ? (
        <EmptyState icon={TrendingUp} title="No finished calls yet">
          Results show up here once a call is bought back, expires or is assigned.
          {s.open_calls > 0 && <> You have {plural(s.open_calls, 'open call')} worth {money(s.open_premium)} in premium.</>}
        </EmptyState>
      ) : (
        <>
          {s.missing_costs > 0 && (
            <p className="mb-6 flex items-start gap-2 text-15 text-fg-2">
              <Dot tone="amber" className="mt-2" />
              <span>{plural(s.missing_costs, 'bought-back call')} {s.missing_costs === 1 ? 'has' : 'have'} no buyback cost entered, so {s.missing_costs === 1 ? "it's" : "they're"} left out of these totals.{' '}
                <Link to="/positions?tab=history&scope=all" className="link">Add the cost{s.missing_costs === 1 ? '' : 's'}</Link>
              </span>
            </p>
          )}

          <section aria-labelledby="hero-h">
            <h2 id="hero-h" className="text-15 font-medium text-fg-2">
              {v == null ? 'Kept from covered calls' : <>Added by selling covered calls <InfoTip text={TIPS.vsHolding} /></>}
            </h2>
            <div className="hero-num mt-1.5" style={{ color: (v ?? s.realized_all_time) < 0 ? 'var(--loss)' : 'var(--accent)' }}>
              {v == null ? money(s.realized_all_time) : signedMoney(v)}
            </div>
            {v != null && (
              <p className="mt-2.5 max-w-[640px] text-15 text-fg-2">
                Compared with just holding the same shares: {money(s.realized_all_time)} of premium kept
                {s.upside_given_up > 0 && <>, minus {money(s.upside_given_up)} of gains you gave up when shares were called away</>}
                {s.upside_given_up < 0 && <>, plus {money(-s.upside_given_up)} from shares called away above their market price</>}
                {!s.upside_given_up && ', and no gains given up on shares called away'}.
                {s.upside_unknown > 0 && <> {plural(s.upside_unknown, 'assignment')} without a stock price for that day {s.upside_unknown === 1 ? 'is' : 'are'} left out.</>}
              </p>
            )}
          </section>

          {months.length > 0 && selected && (
            <section aria-labelledby="months-h" className="mt-10">
              <div className="flex items-baseline justify-between gap-3">
                <h2 id="months-h" className="text-20 font-semibold tracking-title">Month by month</h2>
                <span className="hidden text-13 text-muted md:inline">Pick a month to see how it adds up</span>
              </div>
              <div className="mt-5 flex flex-col gap-8 md:flex-row md:items-start md:gap-14">
                <div className="min-w-0 md:flex-[2]"><MonthBars months={months} goal={goal} selected={selected.month} onSelect={setPicked} thisMonth={s.month} /></div>
                <div className="md:flex-1"><MonthDetail m={selected} goal={goal} thisMonth={s.month} /></div>
              </div>
            </section>
          )}

          <section aria-label="Totals" className="mt-10 grid grid-cols-2 border-t border-line md:grid-cols-5">
            <Stat className="border-b border-line py-4 pr-3 md:py-5" label={`Kept in ${year}`} value={money(s.realized_this_year)}
              sub={allThisYear ? `from ${plural(s.calls_finished, 'finished call')}` : `${money(s.realized_all_time)} all time`} />
            <Stat className="border-b border-l border-line py-4 pl-4 md:px-5 md:py-5" label={<>Yearly return <InfoTip text={TIPS.annualized} size={12} /></>}
              value={s.annualized_return_pct == null ? '—' : pct(s.annualized_return_pct)} sub="on what your shares cost" />
            <Stat className="border-b border-line py-4 pr-3 md:border-l md:px-5 md:py-5" label="Calls that made money"
              value={s.win_rate_pct == null ? '—' : pct(s.win_rate_pct, 0)} sub="after buybacks and fees" />
            <Stat className="border-b border-l border-line py-4 pl-4 md:px-5 md:py-5" label="Gains on shares called away"
              value={s.share_gains_all_time ? signedMoney(s.share_gains_all_time) : money(0)} sub="what you sold them for, over cost" />
            <Stat className="border-b border-line py-4 pr-3 md:border-l md:px-5 md:py-5" label="Still open" value={money(s.open_premium)}
              sub={<>{plural(s.open_calls, 'call')} · <Link to="/positions" className="link link-quiet">manage</Link></>} />
          </section>

          <section aria-labelledby="calls-h" className="mt-12">
            <h2 id="calls-h" className="text-20 font-semibold tracking-title">Finished calls <span className="font-medium text-muted">{trades.length}</span></h2>
            <div className="mt-2 hidden md:block">
              <table className="dtable">
                <thead>
                  <tr>
                    <th>Closed</th><th>Call</th><th>Result</th><th className="num">Days</th><th className="num">Kept</th>
                    <th className="num">Return</th><th className="num">Per year</th>{anyShareGain && <th className="num">Share gain</th>}
                  </tr>
                </thead>
                <tbody>
                  {shown.map(t => (
                    <tr key={t.id}>
                      <td className="text-fg-2">{fmtDate(t.closed_at)}</td>
                      <td className="font-semibold">{t.ticker} {strike(t.strike)} × {t.contracts}</td>
                      <td className="text-fg-2"><span className="inline-flex items-center gap-2">{t.status === 'ASSIGNED' && <Dot tone="amber" />}{resultText(t)}</span></td>
                      <td className="num text-fg-2">{t.days_held}</td>
                      <td className="num font-semibold" style={{ color: t.option_net < 0 ? 'var(--loss)' : undefined }}>{t.option_net == null ? <span className="text-muted" title="Buyback cost not entered">—</span> : signedMoney(t.option_net)}</td>
                      <td className="num">{t.return_pct == null ? '—' : pct(t.return_pct, 2)}</td>
                      <td className="num text-fg-2">{t.annualized_pct == null ? '—' : pct(t.annualized_pct)}</td>
                      {anyShareGain && <td className="num">{t.share_gain == null ? <span className="text-muted">—</span> : signedMoney(t.share_gain)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="mt-2 md:hidden">
              {shown.map(t => (
                <li key={t.id} className="flex items-center justify-between gap-3 border-b border-line py-3">
                  <div className="min-w-0">
                    <div className="text-15 font-semibold">{t.ticker} {strike(t.strike)} × {t.contracts}</div>
                    <div className="flex items-center gap-1.5 text-13 text-muted">{t.status === 'ASSIGNED' && <Dot tone="amber" />}{resultText(t)} · {fmtDate(t.closed_at)} · {plural(t.days_held, 'day')}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-15 font-semibold" style={{ color: t.option_net < 0 ? 'var(--loss)' : undefined }}>{t.option_net == null ? '—' : signedMoney(t.option_net)}</div>
                    <div className="text-13 text-muted">{t.annualized_pct == null ? '' : `${pct(t.annualized_pct)} a year`}</div>
                  </div>
                </li>
              ))}
            </ul>
            {trades.length > SHOWN && (
              <button type="button" className="link link-quiet mt-2 min-h-11" onClick={() => setShowAll(o => !o)}>
                {showAll ? 'Show fewer' : `Show all ${trades.length}`}
              </button>
            )}
            <p className="mt-3 text-12 text-muted">Kept is premium collected minus the buyback and fees. Return is on what the covered shares cost you.</p>
          </section>
        </>
      )}
    </div>
  )
}
