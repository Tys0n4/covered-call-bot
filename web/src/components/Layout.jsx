// src/components/Layout.jsx
import { NavLink } from 'react-router-dom'
import { useTicker } from '../context/TickerContext'

const NAV = [
  { to: '/',          label: 'Dashboard',  icon: '▦' },
  { to: '/scanner',   label: 'Scanner',    icon: '◎' },
  { to: '/positions', label: 'Positions',  icon: '◈' },
  { to: '/manage',    label: 'Manage',     icon: '⬡' },
  { to: '/settings',  label: 'Settings',   icon: '◌' },
]

export default function Layout({ children }) {
  const { tickers, selected, selectTicker } = useTicker()

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {/* Sidebar */}
      <aside style={{
        width: 220,
        background: 'var(--bg-card)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        position: 'fixed',
        top: 0, left: 0, bottom: 0,
        zIndex: 50,
      }}>
        {/* Logo */}
        <div style={{ padding: '28px 24px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <div style={{
              width: 32, height: 32,
              background: 'linear-gradient(135deg, #7c3aed, #a78bfa)',
              borderRadius: 8,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 16, fontWeight: 800, color: 'white',
            }}>C</div>
            <span style={{ fontWeight: 800, fontSize: 15, letterSpacing: '-0.02em' }}>CovCall</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.06em' }}>SCANNER v1.0</div>
        </div>

        <div style={{ height: 1, background: 'var(--border)', margin: '0 16px 16px' }} />

        {/* Nav */}
        <nav style={{ flex: 1, padding: '0 12px' }}>
          {NAV.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              style={({ isActive }) => ({
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '11px 14px', borderRadius: 10, marginBottom: 4,
                textDecoration: 'none', fontSize: 14,
                fontWeight: isActive ? 700 : 500,
                color: isActive ? 'white' : 'var(--text-muted)',
                background: isActive ? 'linear-gradient(135deg, rgba(124,58,237,0.3), rgba(139,92,246,0.15))' : 'transparent',
                border: isActive ? '1px solid rgba(139,92,246,0.3)' : '1px solid transparent',
                transition: 'all 0.15s',
              })}
            >
              <span style={{ fontSize: 16, opacity: 0.8 }}>{icon}</span>
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Ticker selector */}
        <div style={{ padding: '16px 16px 28px' }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8, paddingLeft: 4 }}>
            Active Ticker
          </div>
          {tickers.length === 0 ? (
            <div style={{
              background: 'var(--purple-dim)', border: '1px solid var(--border)',
              borderRadius: 10, padding: '10px 14px',
              fontFamily: 'JetBrains Mono, monospace', fontWeight: 600,
              fontSize: 16, color: 'var(--purple-light)',
            }}>—</div>
          ) : tickers.length === 1 ? (
            <div style={{
              background: 'var(--purple-dim)', border: '1px solid var(--border)',
              borderRadius: 10, padding: '10px 14px',
              fontFamily: 'JetBrains Mono, monospace', fontWeight: 600,
              fontSize: 16, color: 'var(--purple-light)',
            }}>{tickers[0].ticker}</div>
          ) : (
            <select
              value={selected || ''}
              onChange={e => selectTicker(e.target.value)}
              style={{
                width: '100%',
                background: 'var(--purple-dim)',
                border: '1px solid var(--border)',
                borderRadius: 10,
                padding: '10px 14px',
                fontFamily: 'JetBrains Mono, monospace',
                fontWeight: 600, fontSize: 16,
                color: 'var(--purple-light)',
                cursor: 'pointer', outline: 'none',
                appearance: 'none',
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%238b5cf6' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'right 12px center',
                paddingRight: 32,
              }}
            >
              {tickers.map(t => (
                <option key={t.ticker} value={t.ticker} style={{ background: '#0d0d1e' }}>
                  {t.ticker}
                </option>
              ))}
            </select>
          )}
          {selected && tickers.length > 0 && (
            <div style={{ marginTop: 8, padding: '0 4px' }}>
              {(() => {
                const t = tickers.find(t => t.ticker === selected)
                if (!t) return null
                return (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between' }}>
                    <span>{t.open_total}/{t.total_contracts} open</span>
                    <span style={{ color: 'var(--green)' }}>${t.gross_premium.toFixed(0)} collected</span>
                  </div>
                )
              })()}
            </div>
          )}
        </div>
      </aside>

      {/* Main content */}
      <main style={{ marginLeft: 220, flex: 1, padding: '36px 40px', minHeight: '100vh' }}>
        {children}
      </main>
    </div>
  )
}
