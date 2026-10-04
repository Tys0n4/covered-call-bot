// src/components/PremiumCheck.jsx — one line on the Scanner: are option premiums
// rich, normal or thin right now? (backend core/volatility.py)
import { Gauge, Target } from 'lucide-react'
import InfoTip from './InfoTip'

const pctYear = v => `${Math.round(v * 100)}%`

const TIP = 'Compares the yearly move options are priced for (implied volatility, from near-the-money options) with how much the stock actually moved over the last 20 trading days. Selling calls pays best when options are priced for bigger moves than the stock makes.'

export default function PremiumCheck({ check }) {
  if (!check) return null
  const { level, implied_vol: iv, realized_vol: rv } = check
  const copy = {
    rich:   ['Premiums are rich right now', `Options are priced for ${pctYear(iv)} yearly moves; the stock has moved about ${pctYear(rv)} lately. A good time to sell.`],
    normal: ['Premiums are normal', `Options are priced for ${pctYear(iv)} yearly moves, close to the ${pctYear(rv)} the stock has moved lately.`],
    thin:   ['Premiums are thin right now', `Options are priced for ${pctYear(iv)} yearly moves, but the stock has moved about ${pctYear(rv)} lately, so you're paid less for the risk. Waiting for a calmer stretch may pay more.`],
  }[level]
  return (
    <div className={`premium-check premium-${level}`}>
      <Gauge size={17} strokeWidth={2} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
      <span><strong>{copy[0]}.</strong> {copy[1]} <InfoTip text={TIP} size={12} /></span>
    </div>
  )
}

const usd = v => `$${Math.round(v).toLocaleString('en-US')}`

// One line: do the picks earn enough per contract to reach your monthly goal?
export function GoalCheck({ check, deltaMax }) {
  if (!check) return null
  const { goal, contracts, pace_per_contract: pace, plan_per_contract: plan, met } = check
  return (
    <div className={`premium-check ${met ? 'premium-rich' : 'premium-thin'}`}>
      <Target size={17} strokeWidth={2} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
      {met ? (
        <span><strong>On pace for your {usd(goal)} monthly goal.</strong> After buying back at your target, these calls keep about {usd(plan)} per contract a month;
          the goal needs {usd(pace)} across your {contracts} contracts, so the picks take no more risk than that needs.</span>
      ) : (
        <span><strong>Short of your {usd(goal)} monthly goal.</strong> The best calls up to a {Math.round(deltaMax * 100)}% chance of being
          called keep about {usd(plan)} per contract a month after buying back; the goal needs {usd(pace)}. A longer expiry window or a wider range on the
          Strategy page may help, or the goal may be high for these shares.</span>
      )}
    </div>
  )
}
