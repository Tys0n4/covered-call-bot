// src/components/ServerDown.jsx — shown when the API can't be reached
import { CloudOff, RefreshCw } from 'lucide-react'

export default function ServerDown({ onRetry, fullPage = false, message }) {
  const body = (
    <div role="alert" className="mx-auto flex max-w-[420px] flex-col items-center px-6 py-16 text-center">
      <span className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-surface text-fg-2">
        <CloudOff size={28} strokeWidth={1.75} aria-hidden="true" />
      </span>
      <h2 className="mt-5 text-20 font-semibold tracking-title">Can't reach the server</h2>
      <p className="mt-2 text-15 text-fg-2">
        {message || 'Your data is safe. If the server was asleep, it can take up to a minute to wake up.'}
      </p>
      <button type="button" className="btn btn-primary mt-6" onClick={onRetry}>
        <RefreshCw size={16} strokeWidth={2} /> Try again
      </button>
    </div>
  )
  if (!fullPage) return body
  return <div className="flex min-h-screen items-center justify-center p-4">{body}</div>
}
