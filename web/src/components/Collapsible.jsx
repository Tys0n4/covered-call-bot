// src/components/Collapsible.jsx — "show more" section, closed by default
import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

export default function Collapsible({ label, openLabel, children, defaultOpen = false, right }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <button type="button" className="link link-quiet min-h-11" onClick={() => setOpen(o => !o)} aria-expanded={open}>
          {open ? (openLabel || label) : label}
          <ChevronDown size={16} strokeWidth={2} className={`transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
        {right}
      </div>
      {open && <div className="mt-3">{children}</div>}
    </div>
  )
}
