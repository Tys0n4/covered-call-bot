// src/components/dialogs/Modal.jsx — full-screen dark backdrop for pop-ups.
// Rendered straight into <body> so page animations can't trap or clip it.
// Handles the keyboard for every dialog: Escape closes it (via onDismiss),
// Tab stays inside it, and focus returns to whatever opened it.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export default function Modal({ children, onDismiss, blur = true }) {
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
      first?.focus()
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
      if (opener && document.contains(opener)) opener.focus()
    }
  }, [opener])

  return createPortal(
    <div
      ref={ref}
      className="modal-backdrop"
      onMouseDown={e => { if (onDismiss && e.target === e.currentTarget) onDismiss() }}
      style={{ backdropFilter: blur ? 'blur(4px)' : undefined }}
    >
      {children}
    </div>,
    document.body,
  )
}
