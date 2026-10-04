// src/pages/Performance.jsx — what your covered calls actually made (see app/performance.py)
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, TrendingUp } from 'lucide-react'
import { apiError, getPerformance, getStrategy } from '../api/client'
import PageHeader from '../components/PageHeader'
import InfoTip from '../components/InfoTip'
import ServerDown from '../components/ServerDown'
import EmptyState from '../components/EmptyState'
import { PerformanceSkeleton } from '../components/Skeleton'
import Collapsible from '../components/Collapsible'
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fmtDate, money, pct, plural } from '../lib/format'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const fmtMonth = ym => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`

const TIPS = {
  realized:   'Premium you kept from calls that have finished (bought back, expired or assigned), after buybacks and fees.',
  annualized: 'Net premium as a yearly return on the money in the shares you covered (your cost per share), weighted by how long each call was open.',
  winRate:    'Share of finished calls that made money after buybacks and fees.',
  open:       'Premium from calls that are still open. It is not yours for sure until they finish: buying back costs some of it.',
  shareGains: 'Profit or loss on shares that were called away: (strike − your cost per share) × shares.',
  vsHolding:  'What selling calls added compared with just holding the same shares: the premium you kept after buybacks and fees, minus any gain you gave up when shares were called away below their market price that day. Bought-back calls already include any rise in the stock in their buyback cost.',
}

const signed = (v, color = true) => (
  <span style={color ? { color: v > 0 ? 'var(--green)' : v < 0 ? 'var(--red)' : 'var(--text)' } : undefined}>{money(v)}</span>
)

function Stat({ label, tip, value, sub }) {
  return (
    <div className="card">
      <div className="stat-label">{label} {tip && <InfoTip text={tip} size={12} />}</div>
      <div className="stat-num" style={{ fontSize: 26 }}>{value}</div>
      {sub && <div className="hint" style={{ marginTop: 6 }}>{sub}</div>}
    </div>
  )
}

// Kept per month, oldest first, with the monthly goal as a dashed line
function MonthlyChart({ months, goal }) {
  const data = months.slice().reverse().map(m => ({ label: fmtMonth(m.month), kept: m.option_net }))
  const short = v => `$${Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : Math.round(v)}`
  return (
    <div style={{ height: 240 }}>
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height: 240 }}>
        <BarChart data={data} margin={{ top: 12, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.06)" />
          <XAxis dataKey="label" tick={{ fill: '#8a94a6', fontSize: 12 }} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={short} tick={{ fill: '#8a94a6', fontSize: 12 }} axisLine={false} tickLine={false} width={52} />
          <Tooltip
            cursor={{ fill: 'rgba(255,255,255,0.04)' }}
            contentStyle={{ background: '#202a3e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, fontSize: 12 }}
            labelStyle={{ color: '#cdd0d6' }} itemStyle={{ color: '#ffffff' }}
            formatter={v => [money(v), 'Kept']}
          />
          {goal > 0 && <ReferenceLine y={goal} ifOverflow="extendDomain" stroke="#f2b44a" strokeDasharray="4 4"
            label={{ value: `Goal ${short(goal)}`, position: 'insideTopRight', fill: '#f2b44a', fontSize: 11 }} />}
          <Bar dataKey="kept" radius={[6, 6, 0, 0]} maxBarSize={56}>
            {data.map(d => <Cell key={d.label} fill={d.kept < 0 ? '#f26b7a' : '#3ee0a6'} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// The honest bottom line: did selling calls beat just holding the shares?
function Scorecard({ s }) {
  const v = s.vs_holding
  if (v == null) return null
  const kept = s.realized_all_time
  return (
    <div className="card scorecard" style={{ marginBottom: 16 }}>
      <div className="stat-label">Compared with just holding your shares <InfoTip text={TIPS.vsHolding} size={12} /></div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span className="stat-num" style={{ fontSize: 30, color: v >= 0 ? 'var(--green)' : 'var(--red)' }}>{v >= 0 ? '+' : '−'}{money(Math.abs(v))}</span>
        <span style={{ fontSize: 15, color: 'var(--text-dim)' }}>{v >= 0 ? 'added' : 'lost'} by selling covered calls</span>
      </div>
      <div className="hint" style={{ marginTop: 6 }}>
        {money(kept)} premium kept
        {s.upside_given_up > 0 && <> − {money(s.upside_given_up)} of gains given up when shares were called away</>}
        {s.upside_given_up < 0 && <> + {money(-s.upside_given_up)} from shares called away above their market price</>}
        {!s.upside_given_up && ', and no gains given up on shares called away'}
        .
        {s.upside_unknown > 0 && <> {plural(s.upside_unknown, 'assignment')} without a stock price for that day {s.upside_unknown === 1 ? 'is' : 'are'} left out.</>}
      </div>
    </div>
  )
}

function resultLabel(t) {
  if (t.status === 'EXPIRED') return 'Expired'
  if (t.status === 'ASSIGNED') return <span className="badge badge-amber">Assigned</span>
  return t.rolled ? 'Rolled' : 'Bought back'
}

export default function Performance() {
  const [data, setData]       = useState(null)
  const [failed, setFailed]   = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [goal, setGoal]       = useState(0)        // monthly goal from the Strategy page (0 = off)

  useEffect(() => {
    let cancelled = false
    getPerformance()
      .then(r => { if (!cancelled) { setData(r.data); setFailed(null) } })
      .catch(e => { if (!cancelled) setFailed(apiError(e, null) || true) })
    getStrategy().then(r => { if (!cancelled) setGoal(r.data.monthly_goal || 0) }).catch(() => {})
    return () => { cancelled = true }
  }, [reloadKey])

  const retry = () => { setFailed(null); setData(null); setReloadKey(k => k + 1) }
  const header = <PageHeader title="Performance" subtitle="What your covered calls actually made, after buybacks and fees." />

  if (failed) return <div className="fade-up">{header}<ServerDown onRetry={retry} message={typeof failed === 'string' ? failed : undefined} /></div>
  if (!data) return <div className="fade-up">{header}<PerformanceSkeleton /></div>

  const s = data.summary
  const year = new Date().getFullYear()
  const monthName = new Date().toLocaleDateString('en-CA', { month: 'long' })
  // When every finished call closed this year, "this year" and "all time" are the same number
  const allThisYear = data.trades.every(t => (t.closed_at || '').startsWith(String(year)))
  // No commission at your broker: no Fees column
  const anyFees = data.months.some(m => m.fees > 0)

  return (
    <div className="fade-up">
      {header}

      {s.calls_finished === 0 ? (
        <EmptyState icon={TrendingUp} title="No finished calls yet">
          Results show up here once a call is bought back, expires or is assigned.
          {s.open_calls > 0 && <> You have {plural(s.open_calls, 'open call')} worth {money(s.open_premium)} in premium.</>}
        </EmptyState>
      ) : (
        <>
          {s.missing_costs > 0 && (
            <div className="callout callout-amber" style={{ marginBottom: 20 }}>
              <AlertTriangle size={18} strokeWidth={1.75} style={{ flexShrink: 0 }} />
              <span>{plural(s.missing_costs, 'bought-back call')} {s.missing_costs === 1 ? 'has' : 'have'} no buyback cost entered, so {s.missing_costs === 1 ? "it's" : "they're"} left out of these totals.{' '}
                <Link to="/positions?tab=history&scope=all" style={{ color: 'inherit', fontWeight: 700 }}>Add the cost{s.missing_costs === 1 ? '' : 's'}</Link>
              </span>
            </div>
          )}

          <Scorecard s={s} />

          <div className={allThisYear ? 'grid-3' : 'grid-4'} style={{ marginBottom: 16 }}>
            <Stat label={`Kept in ${monthName}`} tip={TIPS.realized} value={signed(s.realized_this_month)}
              sub={goal > 0 ? `of ${money(goal, 0)} goal` : undefined} />
            {allThisYear
              ? <Stat label={`Kept in ${year}`} tip={TIPS.realized} value={signed(s.realized_this_year)}
                  sub={`from ${plural(s.calls_finished, 'finished call')}, all this year`} />
              : <>
                  <Stat label={`Kept in ${year}`} tip={TIPS.realized} value={signed(s.realized_this_year)} />
                  <Stat label="Kept all time" tip={TIPS.realized} value={signed(s.realized_all_time)} sub={`from ${plural(s.calls_finished, 'finished call')}`} />
                </>}
            <Stat label="Yearly return" tip={TIPS.annualized} value={s.annualized_return_pct == null ? '—' : pct(s.annualized_return_pct)}
              sub="on the cost of the shares covered" />
          </div>
          <div className="grid-3" style={{ marginBottom: 32 }}>
            <Stat label="Calls that made money" tip={TIPS.winRate} value={s.win_rate_pct == null ? '—' : pct(s.win_rate_pct, 0)} />
            <Stat label="Still open" tip={TIPS.open} value={money(s.open_premium)}
              sub={<>{plural(s.open_calls, 'open call')} · <Link to="/positions" style={{ color: 'var(--accent-light)' }}>manage</Link></>} />
            <Stat label="Gains on shares called away" tip={TIPS.shareGains} value={signed(s.share_gains_all_time)} />
          </div>

          <div className="section-title" style={{ marginBottom: 12 }}>Month by month</div>
          {s.missing_costs > 0 && <div className="hint" style={{ marginTop: -8, marginBottom: 12 }}>* Kept leaves out calls with no buyback cost entered.</div>}
          {data.months.length > 1 && (
            <div className="card" style={{ marginBottom: 16, padding: '20px 16px 12px' }}>
              <MonthlyChart months={data.months} goal={goal} />
            </div>
          )}
          <div className="card" style={{ marginBottom: 24, padding: 8 }}>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Month</th><th className="num">Calls finished</th><th className="num">Collected</th>
                    <th className="num">Bought back</th>{anyFees && <th className="num">Fees</th>}<th className="num">Kept</th>
                    <th className="num">Share gains</th>
                  </tr>
                </thead>
                <tbody>
                  {data.months.map(m => (
                    <tr key={m.month}>
                      <td style={{ color: 'var(--text)', fontWeight: 600 }}>{fmtMonth(m.month)}</td>
                      <td className="mono num">{m.calls}</td>
                      <td className="mono num" style={{ color: 'var(--green)' }}>{money(m.premium)}</td>
                      <td className="mono num">{money(m.buybacks)}</td>
                      {anyFees && <td className="mono num">{money(m.fees)}</td>}
                      <td className="mono num" style={{ fontWeight: 600 }}>
                        {signed(m.option_net)}
                        {m.missing_costs > 0 && (
                          <span className="muted" style={{ fontWeight: 400 }} title={`Leaves out ${plural(m.missing_costs, 'call')} with no buyback cost entered`}> *</span>
                        )}
                      </td>
                      <td className="mono num">{m.share_gains ? signed(m.share_gains) : <span className="muted">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <Collapsible label={`Every finished call (${data.trades.length})`} openLabel="Hide calls">
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Closed</th><th>Stock</th><th className="num">Strike</th><th className="num">Contracts</th><th>Result</th>
                      <th className="num">Days</th><th className="num">Kept</th><th className="num">Return</th>
                      <th className="num">Per year</th><th className="num">Share gain</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.trades.map(t => (
                      <tr key={t.id}>
                        <td className="nowrap">{fmtDate(t.closed_at)}</td>
                        <td className="mono" style={{ color: 'var(--text)', fontWeight: 700 }}>{t.ticker}</td>
                        <td className="mono num">{money(t.strike)}</td>
                        <td className="mono num">{t.contracts}</td>
                        <td>{resultLabel(t)}</td>
                        <td className="mono num">{t.days_held}</td>
                        <td className="mono num">{t.option_net == null ? <span className="muted" title="Buyback cost not entered">—</span> : signed(t.option_net)}</td>
                        <td className="mono num">{t.return_pct == null ? '—' : pct(t.return_pct, 2)}</td>
                        <td className="mono num">{t.annualized_pct == null ? '—' : pct(t.annualized_pct)}</td>
                        <td className="mono num">{t.share_gain == null ? <span className="muted">—</span> : signed(t.share_gain)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Collapsible>
          </div>
        </>
      )}
    </div>
  )
}
