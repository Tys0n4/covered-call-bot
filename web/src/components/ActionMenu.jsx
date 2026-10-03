// src/components/ActionMenu.jsx — "⋯" button with a small menu of less-used actions.
// The menu is drawn in <body> with fixed positioning so scrolling tables and
// cards can't clip it. Arrow keys move between items; Escape closes.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MoreHorizontal } from 'lucide-react'

export default function ActionMenu({ items, label = 'More actions' }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const btnRef = useRef(null)
  const menuRef = useRef(null)
  const visible = items.filter(Boolean)

  const close = useCallback((refocus = true) => {
    setOpen(false); setPos(null)
    if (refocus) btnRef.current?.focus()
  }, [])

  // Place under the button, right-aligned; flip above if there's no room below
  useLayoutEffect(() => {
    if (!open || !btnRef.current || !menuRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    const m = menuRef.current.getBoundingClientRect()
    let top = r.bottom + 6
    if (top + m.height > window.innerHeight - 8) top = r.top - m.height - 6
    const left = Math.min(Math.max(r.right - m.width, 8), window.innerWidth - m.width - 8)
    setPos({ top, left })
    menuRef.current.querySelector('[role=menuitem]')?.focus()
  }, [open])

  // Close on outside click, scroll or resize
  useEffect(() => {
    if (!open) return
    const onDown = e => { if (!menuRef.current?.contains(e.target) && !btnRef.current?.contains(e.target)) close(false) }
    const onMove = () => close(false)
    document.addEventListener('mousedown', onDown)
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
    }
  }, [open, close])

  const onKeyDown = e => {
    const els = [...menuRef.current.querySelectorAll('[role=menuitem]')]
    const i = els.indexOf(document.activeElement)
    if (e.key === 'Escape') { e.preventDefault(); close() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); els[(i + 1) % els.length]?.focus() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); els[(i - 1 + els.length) % els.length]?.focus() }
    else if (e.key === 'Tab') close(false)
  }

  if (visible.length === 0) return null
  return (
    <>
      <button ref={btnRef} type="button" className="menu-btn" aria-label={label} aria-haspopup="menu" aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}>
        <MoreHorizontal size={18} strokeWidth={2} />
      </button>
      {open && createPortal(
        <div ref={menuRef} role="menu" aria-label={label} className="menu" onKeyDown={onKeyDown}
          style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }}>
          {visible.map(item => (
            <button key={item.label} type="button" role="menuitem" className={`menu-item${item.danger ? ' danger' : ''}`}
              onClick={() => { close(); item.onClick() }}>
              {item.icon && <item.icon size={15} strokeWidth={1.9} />}
              <span>{item.label}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}
