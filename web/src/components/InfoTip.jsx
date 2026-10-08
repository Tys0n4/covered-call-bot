// src/components/InfoTip.jsx — small ⓘ that explains a term on hover, tap or keyboard focus.
// Kept for real jargon only (delta, open interest …); plain words don't need one.
// The bubble is drawn in <body> with fixed positioning, so scrolling tables,
// cards and dialogs can't clip it; it flips below the icon near the top of the
// screen and stays inside the window.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Info } from 'lucide-react'

const GAP = 8      // space between icon and bubble
const MARGIN = 8   // keep this far from the window edges

export default function InfoTip({ text, size = 14 }) {
  const id = useId()
  const btnRef = useRef(null)
  const bubbleRef = useRef(null)
  const [hover, setHover] = useState(false)
  const [focus, setFocus] = useState(false)
  const [pos, setPos] = useState(null)
  const open = hover || focus

  const place = useCallback(() => {
    const btn = btnRef.current, bubble = bubbleRef.current
    if (!btn || !bubble) return
    const r = btn.getBoundingClientRect()
    const { width: w, height: h } = bubble.getBoundingClientRect()
    let top = r.top - h - GAP
    if (top < MARGIN) top = r.bottom + GAP                          // no room above: show below
    const left = Math.min(Math.max(r.left + r.width / 2 - w / 2, MARGIN), window.innerWidth - w - MARGIN)
    setPos({ top, left })
  }, [])

  // Measure once the bubble is in the page, before it's painted
  useLayoutEffect(() => {
    if (open) place()
  }, [open, place])

  // Follow the icon while the page scrolls or resizes
  useEffect(() => {
    if (!open) return
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, place])

  if (!text) return null
  return (
    <button
      ref={btnRef}
      type="button"
      className={`relative inline-flex shrink-0 align-[-2px] before:absolute before:-inset-2 before:content-[''] ${open ? 'text-fg' : 'text-muted hover:text-fg'}`}
      aria-label="What does this mean?"
      aria-describedby={id}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={() => { setFocus(false); setPos(null) }}
      // Escape hides it again for keyboard users
      onKeyDown={e => { if (e.key === 'Escape') { setHover(false); e.currentTarget.blur() } }}
    >
      <Info size={size} strokeWidth={1.9} aria-hidden="true" />
      {/* Text for screen readers; the visible bubble below is a copy */}
      <span id={id} className="sr-only">{text}</span>
      {open && createPortal(
        <span ref={bubbleRef} className="tip" role="tooltip" aria-hidden="true"
          style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }}>
          {text}
        </span>,
        document.body,
      )}
    </button>
  )
}
