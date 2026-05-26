export default function Spinner({ label = 'Loading...' }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20">
      <div className="w-8 h-8 border-2 border-border border-t-emerald rounded-full animate-spin" />
      <div className="text-sm text-dim font-mono">{label}</div>
    </div>
  )
}
