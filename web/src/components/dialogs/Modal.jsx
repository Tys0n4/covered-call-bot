// src/components/dialogs/Modal.jsx — the pop-up shell: a sheet that slides up from the
// bottom on phones, a centered card on bigger screens. Rendered straight into <body>
// so page animations can't trap or clip it. Handles the keyboard for every dialog:
// Escape closes it (via onDismiss), Tab stays inside it, and focus returns to
// whatever opened it.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export default function Modal({ children, onDismiss, labelledBy, label, role = 'dialog', width, as: Tag = 'div', onSubmit }) {
  const ref = useRef(null)
  // What had focus when the dialog opened; read on first render, before any autoFocus field takes it
  const [opener] = useState(() => document.activeElement)
  const dismissRef = useRef(onDismiss)
  useEffect(() => { dismissRef.current = onDismiss })

  useEffect(() => {
    const box = ref.current
    // Start inside the dialog (an autoFocus field wins if there is one)
    if (!box.contains(document.activeElement)) {
      const first = box.querySelector('input:not([disabled]), select, textarea') || box.querySelector(FOCUSABLE)
      first?.focus({ preventScroll: true })
    }
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); dismissRef.current?.() }
      else if (e.key === 'Tab') {
        const els = [...box.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null)
        if (els.length === 0) return
        const first = els[0], last = els[els.length - 1]
        if (e.shiftKey && (document.activeElement === first || !box.contains(document.activeElement))) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', onKey)
    // Keep the page behind from scrolling while the dialog is open
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true })
    }
  }, [opener])

  return createPortal(
    <div ref={ref} className="backdrop" onMouseDown={e => { if (onDismiss && e.target === e.currentTarget) onDismiss() }}>
      <Tag className="dialog" role={role} aria-modal="true" aria-labelledby={labelledBy} aria-label={labelledBy ? undefined : label}
        style={width ? { maxWidth: width } : undefined} onSubmit={onSubmit}>
        {children}
      </Tag>
    </div>,
    document.body,
  )
}

// Title (and optional line under it) with the close button
export function DialogHead({ id, title, sub, onClose, disabled }) {
  return (
    <>
      <h2 id={id} className="pr-10 text-22 font-semibold tracking-title">{title}</h2>
      {sub && <p className="mt-1 text-15 text-fg-2">{sub}</p>}
      {onClose && (
        <button type="button" className="icon-btn dialog-close" aria-label="Close" onClick={onClose} disabled={disabled}>
          <X size={20} strokeWidth={2} />
        </button>
      )}
    </>
  )
}
