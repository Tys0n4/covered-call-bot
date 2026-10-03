// src/components/dialogs/Modal.jsx — full-screen dark backdrop for pop-ups.
// Rendered straight into <body> so page animations can't trap or clip it.
import { createPortal } from 'react-dom'

export default function Modal({ children, onBackdrop, blur = true }) {
  return createPortal(
    <div
      onMouseDown={e => { if (onBackdrop && e.target === e.currentTarget) onBackdrop() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 100, padding: 16, overflowY: 'auto',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.65)', backdropFilter: blur ? 'blur(4px)' : undefined,
      }}
    >
      {children}
    </div>,
    document.body,
  )
}
