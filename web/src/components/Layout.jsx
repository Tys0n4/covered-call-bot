// src/components/Layout.jsx — sidebar on desktop; top bar + bottom tabs on phones
import { NavLink } from 'react-router-dom'
import { LayoutGrid, ScanLine, Briefcase, SlidersHorizontal, LogOut } from 'lucide-react'
import { useAuth } from '../context/AuthContext'

// Three main steps of the workflow: see where you stand, find a trade, look after it.
const NAV = [
  { to: '/',          label: 'Dashboard', hint: 'Overview',          icon: LayoutGrid },
  { to: '/scanner',   label: 'Scanner',   hint: 'Find a trade',      icon: ScanLine },
  { to: '/positions', label: 'Positions', hint: 'Manage your calls', icon: Briefcase },
]
const STRATEGY = { to: '/strategy', label: 'Strategy', hint: 'Your rules', icon: SlidersHorizontal }

function NavItem({ to, label, hint, icon: Icon, small = false }) {
  return (
    <NavLink to={to} end={to === '/'} className={`nav-item${small ? ' small' : ''}`}>
      {({ isActive }) => (
        <>
          <Icon size={small ? 16 : 18} strokeWidth={1.75} color={isActive ? 'var(--accent-light)' : 'currentColor'} style={{ flexShrink: 0 }} />
          <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25 }}>
            <span className="nav-label">{label}</span>
            {hint && <span className="nav-hint">{hint}</span>}
          </span>
        </>
      )}
    </NavLink>
  )
}

function Logo() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div className="logo-mark">C</div>
      <div style={{ lineHeight: 1.2 }}>
        <div style={{ fontWeight: 700, fontSize: 16, letterSpacing: '-0.01em' }}>CovCall</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Covered call scanner</div>
      </div>
    </div>
  )
}

export default function Layout({ children }) {
  const { authRequired, logout } = useAuth()
  const logoutButton = authRequired && (
    <button className="link-btn" onClick={logout} style={{ color: 'var(--text-muted)', fontSize: 13, padding: '6px 14px' }}>
      <LogOut size={15} strokeWidth={1.75} /> Log out
    </button>
  )

  return (
    <div className="app-shell">
      {/* Desktop sidebar */}
      <aside className="app-sidebar">
        <div style={{ padding: '28px 24px 24px' }}><Logo /></div>
        <nav aria-label="Main" style={{ flex: 1, padding: '0 12px' }}>
          {NAV.map(item => <NavItem key={item.to} {...item} />)}
        </nav>
        <div style={{ padding: '12px 12px 24px', borderTop: '1px solid var(--border)' }}>
          <NavItem {...STRATEGY} small />
          {logoutButton}
        </div>
      </aside>

      {/* Phone top bar */}
      <header className="app-topbar">
        <Logo />
        {logoutButton}
      </header>

      <main className="app-main">{children}</main>

      {/* Phone bottom tabs */}
      <nav className="app-bottomnav" aria-label="Main">
        {[...NAV, STRATEGY].map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} end={to === '/'} className="bottom-tab">
            <Icon size={20} strokeWidth={1.75} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
