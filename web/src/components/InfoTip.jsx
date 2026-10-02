// src/components/InfoTip.jsx — small ⓘ that explains a term on hover or focus
import { Info } from 'lucide-react'

export default function InfoTip({ text, size = 13, align }) {
  if (!text) return null
  return (
    <span className={`infotip${align === 'right' ? ' align-right' : ''}`} tabIndex={0} aria-label={text}>
      <Info size={size} strokeWidth={1.75} />
      <span className="infotip-bubble" role="tooltip">{text}</span>
    </span>
  )
}
