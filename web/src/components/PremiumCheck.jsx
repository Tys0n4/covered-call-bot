// src/components/PremiumCheck.jsx — one plain line on the Scanner: are option
// premiums rich, normal or thin right now? (backend core/volatility.py) The
// numbers behind it are in the ⓘ.
import { Gauge } from 'lucide-react'
import InfoTip from './InfoTip'

const pctYear = v => `${Math.round(v * 100)}%`

const TIP = 'Selling calls pays best when options are priced for bigger moves than the stock actually makes. This compares the two: the yearly move near-the-money options are priced for (implied volatility) and how much the stock moved over the last 20 trading days.'

export default function PremiumCheck({ check, ticker }) {
  if (!check) return null
  const { level, implied_vol: iv, realized_vol: rv } = check
  const copy = {
    rich:   ['Good time to sell.', `${ticker} options are paying more than usual right now.`],
    normal: ['Premiums are normal.', `${ticker} options are paying about what you'd expect.`],
    thin:   ['Premiums are thin right now.', `${ticker} options pay less than usual for how much it moves. Waiting may pay more.`],
  }[level]
  const detail = `Options are priced for ${pctYear(iv)} yearly moves; the stock has moved about ${pctYear(rv)} lately. ${TIP}`
  const tone = level === 'rich' ? 'var(--accent)' : level === 'thin' ? 'var(--amber)' : 'var(--text-2)'
  return (
    <p className="flex items-center gap-2.5 text-15">
      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
        style={{ color: tone, background: `color-mix(in srgb, ${tone} 14%, transparent)` }}>
        <Gauge size={15} strokeWidth={2} aria-hidden="true" />
      </span>
      <span><strong className="font-semibold">{copy[0]}</strong> <span className="text-fg-2">{copy[1]}</span> <InfoTip text={detail} /></span>
    </p>
  )
}

const usd = v => `$${Math.round(v).toLocaleString('en-US')}`

// Inside the recommended trade: do the picks earn enough per contract to reach
// your monthly goal? The working is in the ⓘ.
export function GoalCheck({ check, deltaMax }) {
  if (!check) return null
  const { goal, contracts, pace_per_contract: pace, plan_per_contract: plan, met } = check
  const detail = met
    ? `After buying back at your target, these calls keep about ${usd(plan)} per contract a month; the goal needs ${usd(pace)} across your ${contracts} contracts, so the picks take no more risk than that needs.`
    : `The best calls up to a ${Math.round(deltaMax * 100)}% chance of being called keep about ${usd(plan)} per contract a month after buying back; the goal needs ${usd(pace)}. A longer expiry window or a wider range on the Strategy page may help, or the goal may be high for these shares.`
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="font-semibold" style={{ color: met ? 'var(--accent)' : 'var(--amber)' }}>{met ? 'On pace for' : 'Short of'} your {usd(goal)} goal</span>
      <InfoTip text={detail} />
    </span>
  )
}
