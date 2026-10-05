// src/components/PremiumCheck.jsx — one plain line on the Scanner: are option
// premiums rich, normal or thin right now? (backend core/volatility.py) The
// numbers behind it are in the ⓘ.
import { Gauge, Target } from 'lucide-react'
import InfoTip from './InfoTip'

const pctYear = v => `${Math.round(v * 100)}%`

const TIP = 'Selling calls pays best when options are priced for bigger moves than the stock actually makes. This compares the two: the yearly move near-the-money options are priced for (implied volatility) and how much the stock moved over the last 20 trading days.'

export default function PremiumCheck({ check, ticker }) {
  if (!check) return null
  const { level, implied_vol: iv, realized_vol: rv } = check
  const copy = {
    rich:   ['Good time to sell.', `${ticker} options are paying more than usual right now.`],
    normal: ['Premiums are normal.', `${ticker} options are paying about what you'd expect.`],
    thin:   ['Premiums are thin right now.', `${ticker} options are paying less than usual for how much the stock moves. Waiting for a calmer stretch may pay more.`],
  }[level]
  const detail = `Options are priced for ${pctYear(iv)} yearly moves; the stock has moved about ${pctYear(rv)} lately. ${TIP}`
  return (
    <div className={`premium-check premium-${level}`}>
      <Gauge size={17} strokeWidth={2} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
      <span><strong>{copy[0]}</strong> {copy[1]} <InfoTip text={detail} size={12} /></span>
    </div>
  )
}

const usd = v => `$${Math.round(v).toLocaleString('en-US')}`

// One line inside the recommended trade: do the picks earn enough per contract
// to reach your monthly goal? The working is in the ⓘ.
export function GoalCheck({ check, deltaMax }) {
  if (!check) return null
  const { goal, contracts, pace_per_contract: pace, plan_per_contract: plan, met } = check
  const detail = met
    ? `After buying back at your target, these calls keep about ${usd(plan)} per contract a month; the goal needs ${usd(pace)} across your ${contracts} contracts, so the picks take no more risk than that needs.`
    : `The best calls up to a ${Math.round(deltaMax * 100)}% chance of being called keep about ${usd(plan)} per contract a month after buying back; the goal needs ${usd(pace)}. A longer expiry window or a wider range on the Strategy page may help, or the goal may be high for these shares.`
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: met ? 'var(--green)' : 'var(--amber)' }}>
      <Target size={16} strokeWidth={2} aria-hidden="true" style={{ flexShrink: 0 }} />
      <span>{met ? 'On pace for' : 'Short of'} your {usd(goal)} monthly goal <InfoTip text={detail} size={12} /></span>
    </div>
  )
}
