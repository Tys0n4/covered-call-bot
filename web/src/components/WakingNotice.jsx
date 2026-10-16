// src/components/WakingNotice.jsx — the free server naps when nobody's using it, and the first
// visit after a nap waits several seconds while it starts. Instead of a blank screen, the page
// shows right away and this says what's happening, until the server answers. Checked once per
// page load (GET /health); nothing shows if it answers within WAIT_MS.
import { useEffect, useState } from 'react'
import { getHealth } from '../api/client'

const WAIT_MS = 1500
let ping = null   // { promise, done }

function useServerWaking() {
  const [waking, setWaking] = useState(false)
  useEffect(() => {
    if (!ping) {
      const entry = { done: false }
      const finish = () => { entry.done = true }
      entry.promise = getHealth().then(finish, finish)
      ping = entry
    }
    if (ping.done) return
    let live = true
    const timer = setTimeout(() => { if (live && !ping.done) setWaking(true) }, WAIT_MS)
    ping.promise.then(() => { if (live) setWaking(false) })
    return () => { live = false; clearTimeout(timer) }
  }, [])
  return waking
}

// box: on the sign-up and log-in screen; bar: across the top of the app's pages
export default function WakingNotice({ variant = 'bar', className = '' }) {
  const waking = useServerWaking()
  if (!waking) return null
  if (variant === 'box') {
    return (
      <div role="status" className={`rounded-card border border-edge px-4 py-3.5 ${className}`}>
        <div className="flex items-center justify-between gap-3 text-13">
          <span className="font-semibold">Waking up the server…</span><span className="text-muted">usually 5–10 s</span>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-track"><div className="waking-bar h-1 w-[30%] rounded-full bg-accent" /></div>
        <p className="mt-2 text-12 text-muted">CovCall runs on a free server that naps when nobody's using it. You can fill in the form now; it sends as soon as it's awake.</p>
      </div>
    )
  }
  return (
    <div role="status" className={`mb-5 rounded-card border border-edge px-4 py-3 ${className}`}>
      <div className="flex items-center justify-between gap-3 text-13">
        <span className="font-semibold">Waking up the server…</span><span className="shrink-0 text-muted">usually 5–10 s</span>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-track"><div className="waking-bar h-1 w-[30%] rounded-full bg-accent" /></div>
      <p className="mt-2 text-12 text-muted">CovCall runs on a free server that naps when nobody's using it. Your data loads as soon as it's awake.</p>
    </div>
  )
}
