// src/components/AlertsSection.jsx — Strategy page: Discord message when a call is ready to buy back.
// Saved on its own (not with the strategy rules), since it isn't part of the strategy.
import { useEffect, useState } from 'react'
import { BellRing, Send, Trash2 } from 'lucide-react'
import { apiError, getAlerts, saveAlerts, testAlert } from '../api/client'
import { useToast } from '../context/ToastContext'

const WEBHOOK_RE = /^https:\/\/((canary|ptb)\.)?discord(app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/

const fmtTime = iso => new Date(iso).toLocaleString('en-CA', { weekday: 'short', hour: 'numeric', minute: '2-digit' })

export default function AlertsSection() {
  const toast = useToast()
  const [state, setState] = useState(null)       // { enabled, webhook_set, webhook_hint, last_check_at }
  const [loadError, setLoadError] = useState(null)
  const [url, setUrl] = useState('')
  const [editing, setEditing] = useState(false)  // showing the URL box although one is saved
  const [busy, setBusy] = useState(null)         // 'save' | 'test' | 'toggle' | 'remove'
  const [error, setError] = useState(null)

  useEffect(() => {
    getAlerts().then(r => setState(r.data)).catch(e => setLoadError(apiError(e, "Couldn't load alert settings.")))
  }, [])

  const run = async (what, fn) => {
    setBusy(what); setError(null)
    try { await fn() } catch (e) { setError(apiError(e, 'Something went wrong. Is the API running?')) } finally { setBusy(null) }
  }

  const trimmed = url.trim()
  const urlOk = WEBHOOK_RE.test(trimmed)
  const showBox = !state?.webhook_set || editing

  const saveUrl = () => run('save', async () => {
    // Saving a new webhook turns alerts on, and sends a test so you can see it works
    const r = await saveAlerts({ discord_webhook: trimmed, enabled: true })
    setState(r.data); setUrl(''); setEditing(false)
    await testAlert()
    toast('Alerts on. A test message was sent to your Discord channel.')
  })
  const toggle = on => run('toggle', async () => {
    const r = await saveAlerts({ enabled: on })
    setState(r.data)
    toast(on ? 'Buy-back alerts on' : 'Buy-back alerts paused')
  })
  const sendTest = () => run('test', async () => { await testAlert(); toast('Test message sent. Check your Discord channel.') })
  const remove = () => run('remove', async () => {
    const r = await saveAlerts({ clear_webhook: true })
    setState(r.data); setEditing(false)
    toast('Discord webhook removed')
  })

  return (
    <div className="card">
      <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <BellRing size={17} strokeWidth={2} color="var(--accent-light)" /> Buy-back alerts
      </div>
      <div className="hint" style={{ marginBottom: 18 }}>
        Get a Discord message when an open call reaches your buy-back target, so you don't have to keep checking. Prices are checked every 15 minutes while the market is open.
      </div>

      {loadError ? <div className="hint" style={{ color: 'var(--red)' }}>{loadError}</div> : !state ? (
        <div className="hint" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span className="spinner" style={{ width: 14, height: 14 }} /> Loading…</div>
      ) : (
        <>
          {state.webhook_set && !editing && (
            <div className="alert-status">
              <label className="switch">
                <input type="checkbox" checked={state.enabled} disabled={busy !== null} onChange={e => toggle(e.target.checked)} />
                <span aria-hidden="true" />
                <span>{state.enabled ? 'Alerts on' : 'Alerts paused'}</span>
              </label>
              <span className="hint">Discord webhook {state.webhook_hint}</span>
              <span style={{ flex: 1 }} />
              <button className="btn-secondary" style={{ padding: '7px 14px', fontSize: 13 }} onClick={sendTest} disabled={busy !== null}>
                {busy === 'test' ? <span className="spinner" style={{ width: 13, height: 13 }} /> : <Send size={14} strokeWidth={2} />} Send test
              </button>
              <button className="link-btn" style={{ fontSize: 13 }} onClick={() => setEditing(true)} disabled={busy !== null}>Change</button>
              <button className="link-btn" style={{ fontSize: 13, color: 'var(--text-muted)' }} onClick={remove} disabled={busy !== null} aria-label="Remove webhook">
                <Trash2 size={14} strokeWidth={2} />
              </button>
            </div>
          )}

          {showBox && (
            <>
              <label className="label" htmlFor="discord-webhook">Discord webhook URL</label>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <input id="discord-webhook" className="input" style={{ flex: '1 1 320px' }} type="url" autoComplete="off" spellCheck={false}
                  placeholder="https://discord.com/api/webhooks/…" value={url}
                  aria-invalid={trimmed !== '' && !urlOk} aria-describedby="webhook-help"
                  onChange={e => setUrl(e.target.value)} />
                <button className="btn-primary" onClick={saveUrl} disabled={!urlOk || busy !== null}>
                  {busy === 'save' ? <><span className="spinner" /> Connecting…</> : 'Connect'}
                </button>
                {editing && <button className="btn-secondary" onClick={() => { setEditing(false); setUrl('') }} disabled={busy !== null}>Cancel</button>}
              </div>
              {trimmed !== '' && !urlOk && <div style={{ color: 'var(--red)', fontSize: 12.5, marginTop: 6 }}>Paste the whole webhook URL. It starts with https://discord.com/api/webhooks/</div>}
              <ol id="webhook-help" className="hint webhook-steps">
                <li>In Discord, open the channel you want alerts in and click ⚙ <strong>Edit Channel</strong>.</li>
                <li>Go to <strong>Integrations → Webhooks → New Webhook</strong>, then <strong>Copy Webhook URL</strong>.</li>
                <li>Paste it here and click Connect. You'll get a test message right away.</li>
              </ol>
            </>
          )}

          {state.enabled && state.last_check_at && (
            <div className="hint" style={{ marginTop: 12 }}>Last checked {fmtTime(state.last_check_at)}.</div>
          )}
          {error && <div role="alert" style={{ color: 'var(--red)', fontSize: 13, marginTop: 10 }}>{error}</div>}
        </>
      )}
    </div>
  )
}
