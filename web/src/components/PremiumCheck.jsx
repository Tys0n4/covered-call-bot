// src/components/PremiumCheck.jsx — the Scanner's two checks, each with its working in an ⓘ:
// are option premiums rich, normal or thin right now, and does the call keep you on pace
// for your monthly goal?
import InfoTip from './InfoTip'

const pctYear = v => `${Math.round(v * 100)}%`

const TIP = 'Selling calls pays best when options are priced for bigger moves than the stock actually makes. This compares the two: the yearly move near-the-money options are priced for (implied volatility) and how much the stock moved over the last 20 trading days.'

// The numbers behind "options are paying more than usual" (backend core/volatility.py)
export function PremiumTip({ check }) {
  return <InfoTip text={`Options are priced for ${pctYear(check.implied_vol)} yearly moves; the stock has moved about ${pctYear(check.realized_vol)} lately. ${TIP}`} />
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
