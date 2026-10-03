// src/components/ServerDown.jsx — shown when the API can't be reached
import { CloudOff, RefreshCw } from 'lucide-react'

export default function ServerDown({ onRetry, fullPage = false, message }) {
  const card = (
    <div className="card" role="alert" style={{ textAlign: 'center', padding: '48px 24px', maxWidth: 520, margin: '0 auto' }}>
      <CloudOff size={30} strokeWidth={1.75} color="var(--red)" style={{ marginBottom: 12 }} />
      <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 6 }}>Can't reach the server</div>
      <div className="hint" style={{ marginBottom: 20 }}>
        {message || "Your data is safe, but it couldn't be loaded. If the server was asleep it can take up to a minute to wake up."}
      </div>
      <button className="btn-primary" onClick={onRetry}><RefreshCw size={15} strokeWidth={2} /> Try again</button>
    </div>
  )
  if (!fullPage) return card
  return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>{card}</div>
}
