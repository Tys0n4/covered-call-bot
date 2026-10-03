// src/context/ToastContext.jsx — short confirmations ("Call rolled") with an optional Undo
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, AlertTriangle, X } from 'lucide-react'

const ToastContext = createContext(() => {})

const LIFETIME = 6000            // ms a toast stays up
const LIFETIME_WITH_ACTION = 9000

function Toast({ t, onDismiss }) {
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(t.id), t.action ? LIFETIME_WITH_ACTION : LIFETIME)
    return () => clearTimeout(timer)
  }, [t, onDismiss])
  const Icon = t.tone === 'error' ? AlertTriangle : CheckCircle2
  return (
    <div className={`toast toast-${t.tone || 'success'}`} role={t.tone === 'error' ? 'alert' : 'status'}>
      <Icon size={17} strokeWidth={2} style={{ flexShrink: 0 }} />
      <span style={{ flex: 1 }}>{t.message}</span>
      {t.action && (
        <button className="link-btn" style={{ fontSize: 13 }} disabled={busy}
          onClick={async () => { setBusy(true); try { await t.action.onClick() } finally { onDismiss(t.id) } }}>
          {busy ? <span className="spinner" style={{ width: 12, height: 12 }} /> : t.action.label}
        </button>
      )}
      <button className="toast-close" aria-label="Dismiss" onClick={() => onDismiss(t.id)}><X size={14} /></button>
    </div>
  )
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const nextId = useRef(1)
  const dismiss = useCallback(id => setToasts(ts => ts.filter(t => t.id !== id)), [])
  // toast('Call rolled', { action: { label: 'Undo', onClick: async () => ... }, tone: 'error' })
  const toast = useCallback((message, opts = {}) => {
    const id = nextId.current++
    setToasts(ts => [...ts.slice(-2), { id, message, ...opts }])   // at most 3 on screen
  }, [])

  return (
    <ToastContext.Provider value={toast}>
      {children}
      {createPortal(
        <div className="toast-stack" aria-live="polite">
          {toasts.map(t => <Toast key={t.id} t={t} onDismiss={dismiss} />)}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export const useToast = () => useContext(ToastContext)
