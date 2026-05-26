export default function StatCard({ label, value, sub, accent = 'purple', icon: Icon }) {
  const colors = {
    purple: { bg: 'rgba(139,92,246,0.08)', border: 'rgba(139,92,246,0.2)', color: '#a78bfa' },
    green:  { bg: 'rgba(16,185,129,0.08)',  border: 'rgba(16,185,129,0.2)',  color: '#10b981' },
    red:    { bg: 'rgba(244,63,94,0.08)',   border: 'rgba(244,63,94,0.2)',   color: '#f43f5e' },
    yellow: { bg: 'rgba(245,158,11,0.08)',  border: 'rgba(245,158,11,0.2)',  color: '#f59e0b' },
  }
  const c = colors[accent] || colors.purple

  return (
    <div className="card fade-up" style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>
            {label}
          </div>
          <div className="mono" style={{ fontSize: 26, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
            {value}
          </div>
          {sub && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{sub}</div>}
        </div>
        {Icon && (
          <div style={{ width: 40, height: 40, borderRadius: 10, background: c.bg, border: `1px solid ${c.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon size={18} color={c.color} />
          </div>
        )}
      </div>
    </div>
  )
}
