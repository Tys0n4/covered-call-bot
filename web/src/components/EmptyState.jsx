// src/components/EmptyState.jsx — "nothing here yet": an icon, a short title,
// one line on what to do, and the button that does it.
import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'

export default function EmptyState({ icon: Icon, title, children, action }) {
  return (
    <div className="mx-auto flex max-w-[440px] flex-col items-center px-6 py-14 text-center">
      {Icon && (
        <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-surface text-fg-2">
          <Icon size={24} strokeWidth={1.75} aria-hidden="true" />
        </span>
      )}
      <h2 className="mt-5 text-20 font-semibold tracking-title">{title}</h2>
      {children && <p className="mt-2 text-15 text-fg-2">{children}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}

// The button that takes you Home with the "Add a stock" dialog open
export function AddStockLink({ label = 'Add a stock' }) {
  return <Link to="/?add=1" className="btn btn-primary"><Plus size={16} strokeWidth={2.2} /> {label}</Link>
}
