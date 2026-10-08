// src/components/KeptChart.jsx — Home's big number and chart: premium kept over time
// (from finished calls, after buybacks and fees), against the pace your monthly goal
// needs. Hover or drag across the chart to see any day; the big number follows.
import { useMemo, useState } from 'react'
import { money, plural } from '../lib/format'

const DAY = 86400000
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const RANGES = [{ value: 'month', label: 'Month' }, { value: '3m', label: '3M' }, { value: 'year', label: 'Year' }]

// Dates as UTC midnights, so day arithmetic never trips over daylight saving
const utc = iso => { const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return Date.UTC(y, m - 1, d) }
const todayUtc = () => { const n = new Date(); return Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) }
const parts = t => { const d = new Date(t); return [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()] }
const monthDays = t => { const [y, m] = parts(t); return new Date(Date.UTC(y, m + 1, 0)).getUTCDate() }
const shortDate = t => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const whole = v => `${v < 0 ? '−' : ''}$${Math.round(Math.abs(v)).toLocaleString('en-US')}`

// The days a range covers, and how it's labelled
function windowFor(range, today, firstClose) {
  const [y, m] = parts(today)
  if (range === 'month') return { start: Date.UTC(y, m, 1), end: Date.UTC(y, m + 1, 0), label: `Kept in ${MONTHS[m]}` }
  if (range === '3m') {
    const start = Date.UTC(y, m - 2, 1)
    return { start, end: today, label: `Kept since ${shortDate(start)}` }
  }
  // The year so far, from your first finished call if that came later than January
  const jan = Date.UTC(y, 0, 1)
  const start = firstClose > jan ? Date.UTC(...parts(firstClose).slice(0, 2), 1) : jan
  return { start, end: today, label: `Kept in ${y}` }
}

function ticksFor(range, start, end) {
  if (range === 'month') {
    const [y, m] = parts(start)
    return [Date.UTC(y, m, 1), Date.UTC(y, m, 15), end].map((t, i, all) => ({ t, label: shortDate(t), edge: i === 0 ? 'start' : i === all.length - 1 ? 'end' : null }))
  }
  const out = []
  let [y, m] = parts(start)
  for (let t = Date.UTC(y, m, 1); t <= end; t = Date.UTC(y, ++m, 1)) out.push(t)
  const step = out.length > 6 ? 2 : 1
  return out.filter((_, i) => i % step === 0).map((t, i) => ({ t, label: new Date(t).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }), edge: i === 0 ? 'start' : null }))
}

export default function KeptChart({ trades, goal }) {
  const [range, setRange] = useState('month')
  const [hover, setHover] = useState(null)

  const chart = useMemo(() => {
    const today = todayUtc()
    const known = trades.filter(t => t.closed_at && t.option_net != null)
    const firstThisYear = known.map(t => utc(t.closed_at)).filter(t => t >= Date.UTC(parts(today)[0], 0, 1)).sort((a, b) => a - b)[0] ?? 0
    const { start, end, label } = windowFor(range, today, firstThisYear)
    const n = Math.round((end - start) / DAY) + 1
    const todayIdx = Math.min(n - 1, Math.round((today - start) / DAY))

    const byDay = new Map()
    known.forEach(t => {
      const d = utc(t.closed_at)
      if (d >= start && d <= today) byDay.set(d, (byDay.get(d) || 0) + t.option_net)
    })
    const calls = known.filter(t => { const d = utc(t.closed_at); return d >= start && d <= today }).length

    // Running totals for each day: what you'd kept by the end of it, and the goal's pace
    const days = []
    let kept = 0, pace = 0
    for (let i = 0; i < n; i++) {
      const t = start + i * DAY
      kept += byDay.get(t) || 0
      if (goal > 0) pace += goal / monthDays(t)
      days.push({ t, kept, pace })
    }

    const shown = days.slice(0, todayIdx + 1)
    const top = Math.max(...shown.map(d => d.kept), goal > 0 ? days[n - 1].pace : 0, 1) * 1.12
    const bottom = Math.min(0, ...shown.map(d => d.kept)) * 1.12
    const y = v => 6 + (1 - (v - bottom) / (top - bottom)) * 91   // in %, 6% headroom
    const x = i => ((i + 1) / n) * 1000

    // Income arrives in steps (when calls finish), so draw steps, not a smooth line
    let keptPath = `M0 ${y(0).toFixed(2)}`, prev = 0
    shown.forEach((d, i) => {
      if (d.kept !== prev) { keptPath += ` H${(((i + 0.5) / n) * 1000).toFixed(1)} V${y(d.kept).toFixed(2)}`; prev = d.kept }
    })
    keptPath += ` H${x(todayIdx).toFixed(1)}`
    const pacePath = goal > 0 ? `M0 ${y(0).toFixed(2)}` + days.map((d, i) => ` L${x(i).toFixed(1)} ${y(d.pace).toFixed(2)}`).join('') : null

    return { label, n, todayIdx, days, calls, y, keptPath, pacePath, ticks: ticksFor(range, start, end).map(tk => ({ ...tk, left: ((tk.t - start) / DAY / n) * 100 })) }
  }, [trades, goal, range])

  const { n, todayIdx, days, y } = chart
  const at = hover ?? todayIdx
  const point = days[at]
  const now = days[todayIdx]

  // The line under the big number
  let lead, rest, leadColor = 'var(--accent)'
  if (hover != null) {
    lead = shortDate(point.t)
    rest = goal > 0 ? ` · goal pace ${whole(point.pace)}` : ''
    leadColor = 'var(--text)'
  } else if (range === 'month' && goal > 0) {
    const pct = Math.max(0, Math.round((now.kept / goal) * 100))
    const left = n - 1 - todayIdx
    lead = `${pct}%`
    rest = now.kept >= goal ? ` of your ${whole(goal)} goal. Reached!` : ` of your ${whole(goal)} goal · ${plural(left, 'day')} left`
  } else if (goal > 0) {
    const diff = now.kept - now.pace
    lead = `${whole(Math.abs(diff))} ${diff >= 0 ? 'ahead of' : 'behind'}`
    rest = ' your goal pace'
    if (diff < 0) leadColor = 'var(--text)'
  } else {
    lead = plural(chart.calls, 'finished call')
    rest = chart.calls ? ', after buybacks and fees' : ' yet in this range'
    leadColor = 'var(--text)'
  }

  const scrub = e => {
    const r = e.currentTarget.getBoundingClientRect()
    if (!r.width) return
    const i = Math.max(0, Math.min(todayIdx, Math.ceil(((e.clientX - r.left) / r.width) * n) - 1))
    if (i !== hover) setHover(i)
  }
  const dotLeft = `${((at + 1) / n) * 100}%`
  const paceEnd = goal > 0 ? y(days[n - 1].pace) : null

  return (
    <section aria-label="Premium kept">
      <div className="text-15 font-medium text-fg-2">{chart.label}</div>
      <div className="hero-num mt-1.5">{money(point.kept)}</div>
      <div className="mt-2.5 text-15 text-fg-2" aria-live="polite">
        <span className="font-semibold" style={{ color: leadColor }}>{lead}</span>{rest}
      </div>

      <div className="relative mt-6 h-[180px] cursor-crosshair select-none md:h-[240px]" style={{ touchAction: 'pan-y' }}
        onPointerMove={scrub} onPointerDown={scrub} onPointerLeave={() => setHover(null)} onPointerCancel={() => setHover(null)}
        aria-hidden="true">
        <svg className="block h-full w-full overflow-visible" viewBox="0 0 1000 100" preserveAspectRatio="none">
          {chart.pacePath && <path d={chart.pacePath} fill="none" stroke="var(--pace)" strokeWidth="1.5" strokeDasharray="4 5" vectorEffect="non-scaling-stroke" />}
          <path d={chart.keptPath} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>
        {hover != null && <div className="absolute inset-y-0 w-px bg-pace" style={{ left: dotLeft }} />}
        <div className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent"
          style={{ left: dotLeft, top: `${y(point.kept)}%`, boxShadow: '0 0 0 4px var(--bg)' }} />
        {paceEnd != null && (
          <div className="absolute right-0 rounded-sm bg-bg px-1 text-12 text-muted" style={{ top: `calc(${paceEnd}% + 6px)` }}>
            {range === 'month' ? `${whole(goal)} goal` : 'Goal pace'}
          </div>
        )}
      </div>
      <div className="relative mt-2 h-[18px] text-12 text-muted" aria-hidden="true">
        {chart.ticks.map(tk => (
          <span key={tk.t} className="absolute top-0 whitespace-nowrap"
            style={tk.edge === 'end' ? { right: 0 } : { left: `${tk.left}%`, transform: tk.edge === 'start' ? 'none' : 'translateX(-50%)' }}>
            {tk.label}
          </span>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
        <div role="group" aria-label="Time range" className="flex flex-1 gap-2 md:flex-none md:gap-1">
          {RANGES.map(r => (
            <button key={r.value} type="button" className="chip chip-quiet min-h-11 flex-1 md:min-h-10 md:flex-none"
              aria-pressed={range === r.value} onClick={() => { setRange(r.value); setHover(null) }}>
              {r.label}
            </button>
          ))}
        </div>
        {goal > 0 && (
          <div className="hidden gap-4 text-12 text-muted md:flex" aria-hidden="true">
            <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-3.5 rounded-sm bg-accent" />Kept</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-3.5 border-t-2 border-dashed border-pace" />Goal pace</span>
          </div>
        )}
      </div>
    </section>
  )
}
