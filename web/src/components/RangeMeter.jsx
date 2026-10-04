// src/components/RangeMeter.jsx — where an option's chance of being called sits
// inside your range (Strategy page): left end safer, right end more income
import InfoTip from './InfoTip'
import { TERMS } from '../lib/terms'

export default function RangeMeter({ delta, min, max, color = 'var(--accent)' }) {
  if (delta == null || !(max > min)) return null
  const value = Math.round(delta * 100), lo = Math.round(min * 100), hi = Math.round(max * 100)
  const pos = Math.min(Math.max((delta - min) / (max - min), 0), 1) * 100
  return (
    <div className="range-meter">
      <div className="range-meter-head">
        <span>Chance of being called <InfoTip text={TERMS.delta} size={12} /></span>
        <span className="mono" style={{ color: 'var(--text)', fontSize: 15 }}>{value}%</span>
      </div>
      <div className="range-meter-track" role="img" aria-label={`${value}% chance of being called, in your ${lo}–${hi}% range`}>
        <div className="range-meter-fill" style={{ width: `${pos}%`, background: color }} />
        <div className="range-meter-dot" style={{ left: `${pos}%`, borderColor: color }} />
      </div>
      <div className="range-meter-ends"><span>{lo}% · safer</span><span>{hi}% · more income</span></div>
    </div>
  )
}
