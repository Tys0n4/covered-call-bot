import { NavLink } from 'react-router-dom'
import { LayoutDashboard, ScanLine, Briefcase, Settings, TrendingUp } from 'lucide-react'

const links = [
  { to: '/',          icon: LayoutDashboard, label: 'Dashboard'  },
  { to: '/scanner',   icon: ScanLine,        label: 'Scanner'    },
  { to: '/positions', icon: Briefcase,       label: 'Positions'  },
  { to: '/settings',  icon: Settings,        label: 'Settings'   },
]

export default function Sidebar() {
  return (
    <aside style={{
      width: 220, minHeight: '100vh', padding: '24px 16px',
      borderRight: '1px solid var(--border)',
      background: 'rgba(255,255,255,0.015)',
      display: 'flex', flexDirection: 'column', gap: 8,
      position: 'fixed', top: 0, left: 0, zIndex: 100,
    }}>
      {/* Logo */}
      <div style={{ padding: '8px 12px 28px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 34, height: 34, borderRadius: 10,
            background: 'linear-gradient(135deg, #6d28d9, #8b5cf6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 4px 14px rgba(139,92,246,0.4)',
          }}>
            <TrendingUp size={18} color="white" />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>CallScanner</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Pro</div>
          </div>
        </div>
      </div>

      {/* Nav links */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {links.map(({ to, icon: Icon, label }) => (
          <NavLink key={to} to={to} end={to === '/'} style={({ isActive }) => ({
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 12px', borderRadius: 10, textDecoration: 'none',
            fontSize: 14, fontWeight: isActive ? 600 : 400,
            color: isActive ? 'var(--purple-light)' : 'var(--text-secondary)',
            background: isActive ? 'rgba(139,92,246,0.12)' : 'transparent',
            border: isActive ? '1px solid rgba(139,92,246,0.2)' : '1px solid transparent',
            transition: 'all 0.15s ease',
          })}>
            <Icon size={16} />
            {label}
          </NavLink>
        ))}
      </div>

      {/* Bottom status */}
      <div style={{ marginTop: 'auto', padding: '12px', borderRadius: 10, background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.15)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="pulse-dot" />
          <span style={{ fontSize: 12, color: 'var(--green)', fontWeight: 500 }}>API Connected</span>
        </div>
      </div>
    </aside>
  )
}
