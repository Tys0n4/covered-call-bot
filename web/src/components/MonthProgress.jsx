// src/components/MonthProgress.jsx — Home's big number: what finished calls earned this month
// (after buybacks and fees), a moon lit by the share of your monthly goal, and "<Month> so far":
// the month gone and the goal reached on one scale, with today's pace marked across both.
// Behind pace is said plainly, never in red: the Scanner never takes more risk to catch up.
import { Link } from 'react-router-dom'
import { Moon } from './ui'
import { marketToday, money, plural } from '../lib/format'
import { monthProgress } from '../lib/monthProgress'

const whole = v => `${v < 0 ? '−' : ''}$${Math.round(Math.abs(v)).toLocaleString('en-US')}`

// A label under the bars, kept inside the box near either end
const under = f => (f < 0.15 ? { left: 0 } : f > 0.85 ? { right: 0 } : { left: `${f * 100}%`, transform: 'translateX(-50%)' })

function Bar({ label, frac, color, value, tag }) {
  return (
    <div className="flex items-center gap-[var(--gap)]">
      <span className="w-[var(--lab)] shrink-0 text-13 font-semibold">{label}</span>
      <span className="relative h-2.5 flex-1 rounded-full bg-track">
        <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${frac * 100}%`, background: color }} />
        {tag && (
          <span className={`absolute top-1/2 -translate-y-1/2 whitespace-nowrap text-11 font-semibold md:text-12 ${tag.wideOnly ? 'hidden md:block' : ''}`}
            style={{ left: `calc(${frac * 100}% + 8px)`, color: tag.color }}>{tag.text}</span>
        )}
      </span>
      <span className="w-[var(--val)] shrink-0 text-12 text-fg-2 md:text-13">{value}</span>
    </div>
  )
}

// summary: /performance summary (month, realized_this_month); goal: monthly goal, 0 = none
export default function MonthProgress({ summary, goal }) {
  const p = monthProgress({ kept: summary?.realized_this_month ?? 0, goal, month: summary?.month, today: marketToday() })
  const left = p.daysLeft ? `${plural(p.daysLeft, 'day')} left` : 'last day of the month'
  const hasGoal = p.state !== 'none'

  const sub = !hasGoal ? <>{left} · no monthly goal</>
    : p.state === 'reached' ? <><strong className="font-semibold text-fg">Goal reached</strong> · {left}</>
      : <><strong className="font-semibold text-fg">{p.pct}%</strong> of your {whole(goal)} goal · {left}</>

  const sentence = {
    ahead: <strong className="font-semibold text-fg">You're ahead of today's pace by {money(p.diff)}.</strong>,
    behind: <><strong className="font-semibold text-fg">Behind today's pace by {money(-p.diff)}.</strong>{' '}
      That's okay: your picks stay within your rules, and the Scanner won't take on more risk to catch up.</>,
    reached: <><strong className="font-semibold text-fg">Goal reached{p.daysLeft ? ` with ${plural(p.daysLeft, 'day')} to spare` : ''}.</strong>{' '}
      You're {money(p.over)} over your {whole(goal)} goal. Reaching it doesn't change your picks.</>,
    none: <><strong className="font-semibold text-fg">{money(p.kept)} earned{p.daysLeft ? ` with ${plural(p.daysLeft, 'day')} left` : ''}.</strong>{' '}
      Without a goal there's nothing to pace against.</>,
  }[p.state]

  const moonLabel = !hasGoal ? 'No monthly goal set' : p.state === 'reached' ? 'Goal moon, full' : `Goal moon, ${p.pct}% lit`
  const bars = hasGoal
    ? `Month: day ${p.day} of ${p.days}. Goal: ${whole(p.kept)} of ${whole(goal)}. Today's pace is ${whole(p.pace)}.`
    : `Month: day ${p.day} of ${p.days}.`
  // The tag sits just past the gold, so it shows only where it fits: "behind" needs room before the
  // pace line (more of the bar on a phone, where the bars are short); the sentence says it either way
  const room = (p.monthFrac ?? 0) - (p.goalFrac ?? 0)
  const tag = p.state === 'ahead' && p.goalFrac < 0.7 ? { text: 'ahead', color: 'var(--accent)' }
    : p.state === 'behind' && room >= 0.12 ? { text: 'behind', color: 'var(--text-2)', wideOnly: room < 0.32 } : null

  return (
    <section aria-label={`Earned from calls in ${p.monthName}`}>
      <div className="flex items-center justify-between gap-6">
        <div className="min-w-0">
          <div className="text-13 font-medium text-muted md:text-15">Earned from calls in {p.monthName}</div>
          <div className="hero-num mt-1.5">{money(p.kept)}</div>
          <div className="mt-2 text-13 text-fg-2 md:text-15">{sub}</div>
        </div>
        <Moon pct={hasGoal ? p.goalFrac * 100 : 0} empty={!hasGoal} ring={p.state === 'reached'} size={96}
          label={moonLabel} className="h-20 w-20 md:h-24 md:w-24" />
      </div>

      <div className="mt-6 rounded-card border border-line bg-surface p-4 md:p-5">
        <h2 className="font-display text-17 font-medium md:text-20">{p.monthName} so far</h2>
        <p className="mt-1.5 text-13 text-fg-2 md:text-15">{sentence}</p>

        <div role="img" aria-label={bars}
          className={`relative mt-4 flex flex-col gap-3 [--gap:10px] [--lab:48px] [--val:92px] md:[--gap:14px] md:[--lab:64px] md:[--val:140px] ${hasGoal ? 'pb-6' : ''}`}>
          <Bar label="Month" frac={p.monthFrac} color="var(--pace)" value={`Day ${p.day} of ${p.days}`} />
          {hasGoal && <Bar label="Goal" frac={p.goalFrac} color="var(--gold)" value={`${whole(p.kept)} of ${whole(goal)}`} tag={tag} />}
          {hasGoal && (
            <div aria-hidden="true" className="pointer-events-none absolute inset-y-0"
              style={{ left: 'calc(var(--lab) + var(--gap))', right: 'calc(var(--val) + var(--gap))' }}>
              <span className="absolute top-0 bottom-5 border-l-2 border-dashed border-fg" style={{ left: `${p.monthFrac * 100}%` }} />
              <span className="absolute bottom-0 whitespace-nowrap text-11 text-fg md:text-12" style={under(p.monthFrac)}>Today's pace · {whole(p.pace)}</span>
            </div>
          )}
        </div>

        <p className="mt-3 border-t border-line pt-3 text-12 text-muted">
          {hasGoal
            ? "Pace is where you'd be if your goal came in evenly through the month. Gold past the dashed line means you're ahead."
            : <>A monthly goal is optional. It paces the picks, never past your rules. <Link to="/strategy" className="link text-12">Set a goal</Link></>}
        </p>
      </div>
    </section>
  )
}
