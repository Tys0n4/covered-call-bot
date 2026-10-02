// src/components/Collapsible.jsx — "show more" section, closed by default
import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

export default function Collapsible({ label, openLabel, children, defaultOpen = false, right }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <button type="button" className="link-btn" onClick={() => setOpen(o => !o)} aria-expanded={open}>
          <ChevronDown size={16} strokeWidth={2} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
          {open ? (openLabel || label) : label}
        </button>
        {right}
      </div>
      {open && <div style={{ marginTop: 16 }}>{children}</div>}
    </div>
  )
}
