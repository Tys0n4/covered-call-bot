// src/components/EmptyState.jsx — the "nothing here yet" card: an icon, a
// short title, one line on what to do, and the button that does it.
import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'

export default function EmptyState({ icon: Icon, title, children, action }) {
  return (
    <div className="card empty-state">
      {Icon && <span className="empty-icon"><Icon size={24} strokeWidth={1.75} aria-hidden="true" /></span>}
      <div style={{ fontWeight: 700, fontSize: 16 }}>{title}</div>
      {children && <div className="hint" style={{ maxWidth: 420 }}>{children}</div>}
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  )
}

// The button that takes you to the Dashboard with the "Add a stock" dialog open
export function AddStockLink({ label = 'Add a stock' }) {
  return <Link to="/?add=1" className="btn-primary" style={{ textDecoration: 'none' }}><Plus size={16} strokeWidth={2} /> {label}</Link>
}
