// src/components/AlertsSection.jsx — Strategy page: a Discord message when a call needs you (ready to
// buy back, likely to be exercised early, or the stock above your strike), and a warning when the
// scheduled check has stopped or Discord refused a message. Saved on its own, apart from the strategy.
import { useEffect, useState } from 'react'
import { apiError, getAlerts, saveAlerts, testAlert } from '../api/client'
import { useToast } from '../context/ToastContext'
import Collapsible from './Collapsible'
import { Dot, Field, Spinner, Switch } from './ui'

const WEBHOOK_RE = /^https:\/\/((canary|ptb)\.)?discord(app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/

const fmtTime = iso => new Date(iso).toLocaleString('en-US', { weekday: 'long', hour: 'numeric', minute: '2-digit' })

export default function AlertsSection() {
  const toast = useToast()
  const [state, setState] = useState(null)       // GET /alerts: enabled, webhook_set, webhook_hint, last_check_at, check_overdue, last_error, notify_*
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
    toast(on ? 'Discord alerts on' : 'Discord alerts paused')
  })
  const setKind = (key, on) => run('toggle', async () => {
    const r = await saveAlerts({ [key]: on })
    setState(r.data)
  })
  const sendTest = () => run('test', async () => { await testAlert(); toast('Test message sent. Check your Discord channel.') })
  const remove = () => run('remove', async () => {
    const r = await saveAlerts({ clear_webhook: true })
    setState(r.data); setEditing(false)
    toast('Discord webhook removed')
  })

  return (
    <section aria-labelledby="alerts-h">
      <h2 id="alerts-h" className="text-17 font-semibold">Discord alerts</h2>
      {loadError ? <p className="mt-2 text-13 text-loss">{loadError}</p> : !state ? (
        <p className="mt-3 flex items-center gap-2 text-13 text-muted"><Spinner className="h-3.5 w-3.5" /> Loading…</p>
      ) : (
        <>
          {state.webhook_set && (
            <div className="flex items-center justify-between gap-4 border-b border-line py-3">
              <div>
                <div className="text-15">A message when a call is ready to buy back</div>
                <div className="text-13 text-muted">Checked every 30 minutes while the market is open</div>
              </div>
              <Switch checked={state.enabled} disabled={busy !== null} onChange={toggle} label="Discord alerts" />
            </div>
          )}
          {state.webhook_set && state.enabled && [
            ['notify_early', 'Also when a call may be exercised early', 'In the money with less time value left than the coming dividend'],
            ['notify_strike', 'Also when a stock goes above your strike', 'Once per call, so you can buy back, roll or let the shares go'],
          ].map(([key, label, sub]) => (
            <div key={key} className="flex items-center justify-between gap-4 border-b border-line py-3">
              <div><div className="text-15">{label}</div><div className="text-13 text-muted">{sub}</div></div>
              <Switch checked={state[key]} disabled={busy !== null} onChange={on => setKind(key, on)} label={label} />
            </div>
          ))}
          {state.webhook_set && !editing && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-3">
              <div className="text-15"><span className="text-fg-2">Webhook</span> <span className="ml-2">{state.webhook_hint}</span></div>
              <div className="flex items-center gap-1">
                <button type="button" className="btn btn-secondary btn-sm" onClick={sendTest} disabled={busy !== null}>
                  {busy === 'test' && <Spinner className="h-3.5 w-3.5" />} Send test
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)} disabled={busy !== null}>Change</button>
                <button type="button" className="btn btn-ghost btn-sm text-loss hover:text-loss" onClick={remove} disabled={busy !== null}>Remove</button>
              </div>
            </div>
          )}

          {showBox && (
            <div className="mt-3">
              {!state.webhook_set && <p className="mb-4 text-15 text-fg-2">Get a Discord message when a call needs you: ready to buy back, likely to be exercised early, or the stock above your strike. No need to keep checking.</p>}
              <div className="flex flex-wrap items-end gap-2.5">
                <Field className="min-w-0 flex-[1_1_280px]" id="discord-webhook" label="Discord webhook URL" type="url" spellCheck={false}
                  placeholder="https://discord.com/api/webhooks/…" value={url} onChange={e => setUrl(e.target.value)}
                  error={trimmed !== '' && !urlOk ? 'Paste the whole webhook URL. It starts with https://discord.com/api/webhooks/' : null} />
                <button type="button" className="btn btn-primary" onClick={saveUrl} disabled={!urlOk || busy !== null}>
                  {busy === 'save' ? <><Spinner /> Connecting…</> : 'Connect'}
                </button>
                {editing && <button type="button" className="btn btn-secondary" onClick={() => { setEditing(false); setUrl('') }} disabled={busy !== null}>Cancel</button>}
              </div>
              <div className="mt-1">
                <Collapsible label="How do I get this URL?" openLabel="Hide the steps">
                  <ol className="list-decimal space-y-1 pl-5 text-13 text-fg-2">
                    <li>In Discord, open the channel you want alerts in and choose <strong className="font-semibold text-fg">Edit Channel</strong>.</li>
                    <li>Go to <strong className="font-semibold text-fg">Integrations → Webhooks → New Webhook</strong>, then <strong className="font-semibold text-fg">Copy Webhook URL</strong>.</li>
                    <li>Paste it here and choose Connect. You'll get a test message right away.</li>
                  </ol>
                </Collapsible>
              </div>
            </div>
          )}

          {state.webhook_set && state.enabled && state.last_error ? (
            <p role="alert" className="mt-2 flex items-start gap-2 text-13 text-loss">
              <Dot tone="loss" className="mt-1.5" /><span>The last alert couldn't be sent: {state.last_error} Send a test once it's fixed.</span>
            </p>
          ) : state.webhook_set && state.check_overdue ? (
            <p role="alert" className="mt-2 flex items-start gap-2 text-13 text-fg-2">
              <Dot tone="amber" className="mt-1.5" />
              <span>{state.last_check_at ? `No scheduled check since ${fmtTime(state.last_check_at)}` : 'No scheduled check has run yet'}, so alerts can't be sent.
                Check that the cron-job.org job is still on and calling /alerts/cron every 30 minutes.</span>
            </p>
          ) : state.webhook_set && (
            <p className="mt-2 text-13 text-muted">
              {state.enabled ? (state.last_check_at ? `Alerts on. Last checked ${fmtTime(state.last_check_at)}.` : 'Alerts on.') : 'Alerts paused. Nothing is sent until you turn them back on.'}
            </p>
          )}
          {error && <p role="alert" className="mt-2 text-13 text-loss">{error}</p>}
        </>
      )}
    </section>
  )
}
