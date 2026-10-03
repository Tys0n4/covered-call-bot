// src/components/InfoTip.jsx — small ⓘ that explains a term on hover, tap or keyboard focus
import { useId } from 'react'
import { Info } from 'lucide-react'

export default function InfoTip({ text, size = 13, align }) {
  const id = useId()
  if (!text) return null
  return (
    <button
      type="button"
      className={`infotip${align === 'right' ? ' align-right' : ''}`}
      aria-label="What does this mean?"
      aria-describedby={id}
      // Escape hides it again for keyboard users
      onKeyDown={e => { if (e.key === 'Escape') e.currentTarget.blur() }}
    >
      <Info size={size} strokeWidth={1.75} aria-hidden="true" />
      <span className="infotip-bubble" role="tooltip" id={id}>{text}</span>
    </button>
  )
}
