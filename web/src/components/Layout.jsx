// src/components/Layout.jsx
import { NavLink } from 'react-router-dom'
import { LayoutGrid, ScanLine, Briefcase, SlidersHorizontal, LogOut } from 'lucide-react'
import { useAuth } from '../context/AuthContext'

// Three main steps of the workflow: see where you stand, find a trade, look after it.
const NAV = [
  { to: '/',          label: 'Dashboard', hint: 'Overview',          icon: LayoutGrid },
  { to: '/scanner',   label: 'Scanner',   hint: 'Find a trade',      icon: ScanLine },
  { to: '/positions', label: 'Positions', hint: 'Manage your calls', icon: Briefcase },
]

function NavItem({ to, label, hint, icon: Icon, small = false }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      style={({ isActive }) => ({
        display: 'flex', alignItems: 'center', gap: 12,
        padding: small ? '9px 14px' : '11px 14px', borderRadius: 12, marginBottom: 4,
        textDecoration: 'none',
        color: isActive ? 'var(--text)' : 'var(--text-dim)',
        background: isActive ? 'var(--bg-hover)' : 'transparent',
        transition: 'background 0.15s, color 0.15s',
      })}
    >
      {({ isActive }) => (
        <>
          <Icon size={small ? 16 : 18} strokeWidth={1.75} color={isActive ? 'var(--accent-light)' : 'currentColor'} style={{ flexShrink: 0 }} />
          <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25 }}>
            <span style={{ fontSize: small ? 14 : 15, fontWeight: isActive ? 700 : 600 }}>{label}</span>
            {hint && <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 400 }}>{hint}</span>}
          </span>
        </>
      )}
    </NavLink>
  )
}

export default function Layout({ children }) {
  const { authRequired, logout } = useAuth()
  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {/* Sidebar */}
      <aside style={{
        width: 232,
        background: 'var(--bg-card)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        position: 'fixed',
        top: 0, left: 0, bottom: 0,
        zIndex: 50,
      }}>
        {/* Logo */}
        <div style={{ padding: '28px 24px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="logo-mark">C</div>
            <div style={{ lineHeight: 1.2 }}>
              <div style={{ fontWeight: 700, fontSize: 16, letterSpacing: '-0.01em' }}>CovCall</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Covered call scanner</div>
            </div>
          </div>
        </div>

        <nav style={{ flex: 1, padding: '0 12px' }}>
          {NAV.map(item => <NavItem key={item.to} {...item} />)}
        </nav>

        <div style={{ padding: '12px 12px 24px', borderTop: '1px solid var(--border)' }}>
          <NavItem to="/strategy" label="Strategy" hint="Your rules" icon={SlidersHorizontal} small />
          {authRequired && (
            <button className="link-btn" onClick={logout} style={{ color: 'var(--text-muted)', fontSize: 13, padding: '6px 14px' }}>
              <LogOut size={15} strokeWidth={1.75} /> Log out
            </button>
          )}
        </div>
      </aside>

      {/* Main content */}
      <main style={{ marginLeft: 232, flex: 1, padding: '40px 48px', minHeight: '100vh', maxWidth: 1400 }}>
        {children}
      </main>
    </div>
  )
}
