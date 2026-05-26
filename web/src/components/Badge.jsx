export default function Badge({ children, variant = 'default' }) {
  const styles = {
    default: 'bg-muted/50 text-text',
    live:    'bg-emerald/20 text-emerald border border-emerald/30',
    stale:   'bg-amber/20 text-amber border border-amber/30',
    bad:     'bg-red/20 text-red border border-red/30',
    income:  'bg-blue/20 text-blue-400 border border-blue/30',
    balanced:'bg-purple-500/20 text-purple-400 border border-purple-500/30',
    buyback: 'bg-emerald/20 text-emerald border border-emerald/30',
    hold:    'bg-muted/50 text-dim border border-border',
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-medium ${styles[variant] || styles.default}`}>
      {children}
    </span>
  )
}
