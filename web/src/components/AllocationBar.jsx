export default function AllocationBar({ income, balanced, total }) {
  const incomeW = total > 0 ? (income / total) * 100 : 0
  const balancedW = total > 0 ? (balanced / total) * 100 : 0
  const openW = 100 - incomeW - balancedW

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Contract Allocation</span>
        <span className="mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>{income + balanced}/{total} open</span>
      </div>
      <div style={{ height: 8, borderRadius: 99, background: 'rgba(255,255,255,0.05)', overflow: 'hidden', display: 'flex' }}>
        <div style={{ width: `${incomeW}%`, background: 'linear-gradient(90deg, #6d28d9, #8b5cf6)', transition: 'width 0.6s ease' }} />
        <div style={{ width: `${balancedW}%`, background: 'linear-gradient(90deg, #8b5cf6, #a78bfa)', transition: 'width 0.6s ease' }} />
        <div style={{ width: `${openW}%`, background: 'rgba(255,255,255,0.04)' }} />
      </div>
      <div style={{ display: 'flex', gap: 16, marginTop: 10 }}>
        {[
          { label: 'Income', value: income, color: '#8b5cf6' },
          { label: 'Balanced', value: balanced, color: '#a78bfa' },
          { label: 'Available', value: total - income - balanced, color: 'var(--text-muted)' },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 6, height: 6, borderRadius: 99, background: color }} />
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</span>
            <span className="mono" style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600 }}>{value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
