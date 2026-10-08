// src/pages/Strategy.jsx — your covered call strategy (saved to the database), plus
// alerts, broker, appearance and your data. Each trading rule opens in place on
// bigger screens and in a sheet on phones; changes wait for Save.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, Download, LogOut } from 'lucide-react'
import { getStrategy, saveStrategy, getPortfolio, getAllPositions, getPerformance, apiError } from '../api/client'
import PageHeader from '../components/PageHeader'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { useToast } from '../context/ToastContext'
import AlertsSection from '../components/AlertsSection'
import Modal from '../components/dialogs/Modal'
import { Field, Segmented, Spinner } from '../components/ui'
import { DEFAULT_STRATEGY, buybackPrice, splitContracts } from '../lib/strategy'
import { forgetStrategy } from '../lib/useStrategy'
import { useWide } from '../lib/useWide'
import { money, plural } from '../lib/format'

function downloadCsv(filename, columns, rows) {
  const cell = v => {
    const t = v == null ? '' : String(v)
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
  }
  const text = [columns.join(','), ...rows.map(r => columns.map(c => cell(r[c])).join(','))].join('\n')
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  document.body.appendChild(a); a.click(); a.remove()
  URL.revokeObjectURL(url)
}

// 1000 -> '1000', 0 -> '' (empty box shows the placeholder)
const goalToText = g => (g > 0 ? String(Math.round(g)) : '')
// 0.65 -> '0.65', 0 -> '0'
const commToText = c => (c > 0 ? String(Number(c.toFixed(2))) : '0')
const digits = (t, n) => t.replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '').slice(0, n)

// The trading rules (everything but the goal and commission)
const RULE_KEYS = ['delta_min', 'delta_max', 'min_dte', 'max_dte', 'profit_capture_target_pct', 'event_buyback_pct', 'income_weight', 'buyback_budget_pct']
const usesDefaults = d => RULE_KEYS.every(k => Math.abs(d[k] - DEFAULT_STRATEGY[k]) < 1e-9)

const APPEARANCE = [{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]

function Section({ id, title, right, children, className = 'mt-10' }) {
  return (
    <section aria-labelledby={id} className={className}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={id} className="text-17 font-semibold">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  )
}

// One trading rule: its value on the right; opens in place (wide screens) or in a sheet (phones)
function RuleRow({ label, value, invalid, open, onOpen, onDone, onCancel, wide, children }) {
  return (
    <li className="border-b border-line">
      <button type="button" className="flex min-h-14 w-full items-center gap-3 text-left text-15" aria-expanded={open} onClick={open ? onDone : onOpen}>
        <span className="flex-1">{label}</span>
        <span className="font-semibold" style={invalid ? { color: 'var(--loss)' } : undefined}>{value}</span>
        <ChevronRight size={16} strokeWidth={2} aria-hidden="true" className={`shrink-0 text-muted transition-transform ${open && wide ? 'rotate-90' : ''}`} />
      </button>
      {open && wide && <div className="pb-5">{children}</div>}
      {open && !wide && (
        <Modal onDismiss={onCancel} labelledBy="rule-sheet-title">
          <h2 id="rule-sheet-title" className="text-17 font-semibold">{label}</h2>
          <div className="mt-1 text-44 font-semibold tracking-hero" style={invalid ? { color: 'var(--loss)' } : undefined}>{value}</div>
          <div className="mt-3">{children}</div>
          <div className="dialog-actions">
            <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={onDone} disabled={invalid}>Done</button>
          </div>
        </Modal>
      )}
    </li>
  )
}

const Range = ({ label, min, max, step, value, onChange }) => (
  <>
    <input type="range" className="range" aria-label={label} min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} />
    <div className="flex justify-between text-12 text-muted" aria-hidden="true"><span>{min}%</span><span>{max}%</span></div>
  </>
)

export default function Strategy() {
  const toast = useToast()
  const wide = useWide()
  const { authRequired, logout } = useAuth()
  const { preference, setPreference } = useTheme()
  const [saved, setSaved]       = useState(null)    // what the server has
  const [draft, setDraft]       = useState(null)    // what's on screen
  const [goalText, setGoalText] = useState('')      // goal box exactly as typed ('' = no goal)
  const [commText, setCommText] = useState('0')     // commission box exactly as typed
  const [loadError, setLoadError] = useState(null)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState(null)
  const [positions, setPositions] = useState([])
  const [holdings, setHoldings] = useState([])
  const [exporting, setExporting] = useState(false)
  const [perf, setPerf]         = useState(null)    // /performance summary + months
  const [open, setOpen]         = useState(null)    // the rule being edited, and the draft before it opened

  useEffect(() => {
    getStrategy()
      .then(r => { const s = { ...DEFAULT_STRATEGY, ...r.data }; setSaved(s); setDraft(s); setGoalText(goalToText(s.monthly_goal)); setCommText(commToText(s.commission_per_contract)) })
      .catch(e => setLoadError(apiError(e, 'Could not load your strategy. Is the API running?')))
    getAllPositions().then(r => setPositions(r.data)).catch(() => {})
    getPortfolio().then(r => setHoldings(r.data)).catch(() => {})
    getPerformance().then(r => setPerf(r.data)).catch(() => {})
  }, [])

  // The goal tracks what you KEPT this month: the same number as the Performance
  // page (calls that finished this month, net of buybacks and fees).
  const monthKey  = perf?.summary.month
  const monthName = monthKey
    ? new Date(Number(monthKey.slice(0, 4)), Number(monthKey.slice(5, 7)) - 1, 1).toLocaleDateString('en-US', { month: 'long' })
    : ''
  const monthRow  = perf?.months.find(m => m.month === monthKey)
  const monthKept = perf?.summary.realized_this_month ?? 0
  const openSoldThisMonth = positions.filter(p => p.status === 'OPEN' && monthKey && (p.opened_at || '').startsWith(monthKey))
  const openPremium = openSoldThisMonth.reduce((sum, p) => sum + p.premium_total - (p.open_fees || 0), 0)
  const goalPct = draft?.monthly_goal > 0 ? Math.max(0, Math.round((monthKept / draft.monthly_goal) * 100)) : 0

  const exportHoldings = async () => {
    setExporting(true)
    try {
      const r = await getPortfolio()
      downloadCsv('holdings.csv', ['ticker', 'shares', 'avg_cost'], r.data)
    } finally { setExporting(false) }
  }
  const exportPositions = async () => {
    setExporting(true)
    try {
      const r = await getAllPositions()
      downloadCsv('trades.csv', ['id', 'ticker', 'allocation_type', 'status', 'expiry', 'strike', 'contracts', 'entry_price', 'premium_total', 'open_fees', 'close_cost', 'close_fees', 'cost_basis', 'rolled_from', 'opened_at', 'closed_at'], r.data)
    } finally { setExporting(false) }
  }

  const set = (k, v) => setDraft(d => ({ ...d, [k]: v }))
  const dirty = saved && draft && JSON.stringify(saved) !== JSON.stringify(draft)

  const handleSave = async () => {
    setSaving(true); setError(null)
    try {
      const r = await saveStrategy(draft)
      const s = { ...DEFAULT_STRATEGY, ...r.data }
      setSaved(s); setDraft(s); setGoalText(goalToText(s.monthly_goal)); setCommText(commToText(s.commission_per_contract))
      forgetStrategy(s)
      setOpen(null)
      toast('Strategy saved. It applies to your next scan and price check.')
    } catch (e) {
      setError(apiError(e))
    } finally {
      setSaving(false)
    }
  }
  const discard = () => { setDraft(saved); setGoalText(goalToText(saved.monthly_goal)); setCommText(commToText(saved.commission_per_contract)); setError(null); setOpen(null) }

  if (loadError) {
    return <div className="page"><PageHeader title="Strategy" /><p role="alert" className="text-15 text-loss">{loadError}</p></div>
  }
  if (!draft) {
    return <div className="page"><PageHeader title="Strategy" /><div className="flex justify-center py-20 text-muted"><Spinner className="h-8 w-8" /></div></div>
  }

  const incomePct = Math.round(draft.income_weight * 100)
  const reservePct = Math.round(draft.buyback_budget_pct * 100)
  const dMin = Math.round(draft.delta_min * 100), dMax = Math.round(draft.delta_max * 100)
  const deltaErr = !(dMin >= 5 && dMax <= 60 && dMin < dMax)
  const dteErr = !(draft.min_dte >= 1 && draft.max_dte <= 120 && draft.min_dte < draft.max_dte)
  const commErr = !(draft.commission_per_contract >= 0 && draft.commission_per_contract <= 10)
  const invalid = deltaErr || dteErr || commErr
  const example = buybackPrice(0.34, draft.profit_capture_target_pct)

  // Each rule row; "open" remembers the draft from before it opened so Cancel can put it back
  const rule = (id, label, value, bad, editor) => (
    <RuleRow key={id} label={label} value={value} invalid={bad} wide={wide} open={open?.id === id}
      onOpen={() => setOpen({ id, before: draft })}
      onDone={() => setOpen(null)}
      onCancel={() => { setDraft(open.before); setOpen(null) }}>
      {editor}
    </RuleRow>
  )

  return (
    <div className="page mx-auto max-w-[720px]">
      <PageHeader title="Strategy" />
      <p className="-mt-3 text-15 text-fg-2 md:-mt-5">How CovCall picks trades and tells you when to buy back. Changes apply to your next scan.</p>

      <Section id="goal-h" title="Monthly goal">
        <div className="flex items-center justify-between gap-4 border-b border-line py-3">
          <label htmlFor="goal" className="text-15 text-fg-2">Premium you'd like to keep each month</label>
          <Field id="goal" className="w-32 shrink-0" prefix="$" type="text" inputMode="numeric" placeholder="Off" maxLength={7}
            inputClassName="text-right font-semibold" value={goalText}
            onChange={e => { const t = digits(e.target.value, 7); setGoalText(t); set('monthly_goal', t === '' ? 0 : Number(t)) }} />
        </div>
        {draft.monthly_goal > 0 && perf ? (
          <div className="pt-3.5">
            <div className="flex justify-between gap-3 text-13">
              <span className="text-fg-2"><strong className="font-semibold text-fg">{money(monthKept)}</strong> kept in {monthName}</span>
              <span className="font-semibold">{goalPct}%</span>
            </div>
            <div className="mt-2 h-1 rounded-full bg-track"><div className="h-1 rounded-full bg-accent" style={{ width: `${Math.min(goalPct, 100)}%` }} /></div>
            <p className="mt-2 text-13 text-muted">
              {goalPct >= 100 ? 'Goal reached this month.' : `${money(Math.max(draft.monthly_goal - monthKept, 0))} to go.`}
              {monthRow && <> {plural(monthRow.calls, 'call')} finished: {money(monthRow.premium)} collected{monthRow.buybacks > 0 && <>, {money(monthRow.buybacks)} bought back</>}{monthRow.fees > 0 && <>, {money(monthRow.fees)} fees</>}.</>}
              {monthRow?.missing_costs > 0 && <> {plural(monthRow.missing_costs, 'buyback')} without a cost (<Link to="/positions?tab=history&scope=all" className="link">add it</Link>).</>}
              {openPremium > 0 && <> Plus {money(openPremium)} from {plural(openSoldThisMonth.length, 'call')} sold this month that count once they finish.</>}
            </p>
          </div>
        ) : (
          <p className="mt-2 text-13 text-muted">Optional. Shows your progress on Home and paces the Scanner's picks.</p>
        )}
      </Section>

      <Section id="rules-h" title="Trading rules" right={usesDefaults(draft)
        ? <span className="text-13 font-semibold text-accent">Recommended</span>
        : <span className="text-13 text-muted">Your rules · <button type="button" className="link text-13"
            onClick={() => setDraft(d => ({ ...DEFAULT_STRATEGY, monthly_goal: d.monthly_goal, commission_per_contract: d.commission_per_contract }))}>Back to recommended</button></span>}>
        <ul>
          {rule('delta', 'Chance of being called', `${dMin}–${dMax}%`, deltaErr, <>
            <div className="flex items-center gap-2.5" role="group" aria-label="Chance of being called">
              <Field className="w-24" aria-label="Lowest chance" suffix="%" type="text" inputMode="numeric" value={Number.isFinite(dMin) ? String(dMin) : ''}
                inputClassName="text-right" aria-invalid={deltaErr || undefined} onChange={e => { const t = digits(e.target.value, 2); set('delta_min', t === '' ? NaN : Number(t) / 100) }} />
              <span className="text-muted">to</span>
              <Field className="w-24" aria-label="Highest chance" suffix="%" type="text" inputMode="numeric" value={Number.isFinite(dMax) ? String(dMax) : ''}
                inputClassName="text-right" aria-invalid={deltaErr || undefined} onChange={e => { const t = digits(e.target.value, 2); set('delta_max', t === '' ? NaN : Number(t) / 100) }} />
            </div>
            <p className={`mt-2 text-13 ${deltaErr ? 'text-loss' : 'text-muted'}`}>
              {deltaErr ? 'Use a range between 5% and 60%, low to high.' : 'Roughly the chance the stock ends above the strike and your shares are sold. The Scanner only looks at calls in this range; before earnings or a Fed decision, picks stay near the low end.'}
            </p>
          </>)}
          {rule('dte', 'Expiring in', `${draft.min_dte}–${draft.max_dte} days`, dteErr, <>
            <div className="flex items-center gap-2.5" role="group" aria-label="Expiring in">
              <Field className="w-24" aria-label="Fewest days" type="text" inputMode="numeric" inputClassName="text-right" value={Number.isFinite(draft.min_dte) ? String(draft.min_dte) : ''}
                aria-invalid={dteErr || undefined} onChange={e => { const t = digits(e.target.value, 3); set('min_dte', t === '' ? NaN : Number(t)) }} />
              <span className="text-muted">to</span>
              <Field className="w-24" aria-label="Most days" type="text" inputMode="numeric" inputClassName="text-right" value={Number.isFinite(draft.max_dte) ? String(draft.max_dte) : ''}
                aria-invalid={dteErr || undefined} onChange={e => { const t = digits(e.target.value, 3); set('max_dte', t === '' ? NaN : Number(t)) }} />
              <span className="text-muted">days</span>
            </div>
            <p className={`mt-2 text-13 ${dteErr ? 'text-loss' : 'text-muted'}`}>{dteErr ? 'Use 1 to 120 days, shortest first.' : 'Shorter calls pay less each but can be sold more often.'}</p>
          </>)}
          {rule('buyback', 'Buy back at', `${draft.profit_capture_target_pct}% kept`, false, <>
            <Range label="Buy back target, percent of premium kept" min={50} max={95} step={5} value={draft.profit_capture_target_pct}
              onChange={v => setDraft(d => ({ ...d, profit_capture_target_pct: v, event_buyback_pct: Math.min(d.event_buyback_pct, v) }))} />
            <p className="mt-2 text-13 text-fg-2">Positions says “Buy back” once a call is cheap enough that you'd keep this much of its premium.</p>
            <p className="mt-1 text-13 text-muted">
              Example: sold at $0.34 a share → buy back at {money(example)} or less ({((1 - example / 0.34) * 100).toFixed(1)}% kept, the closest cent).
            </p>
          </>)}
          {rule('event', 'Before earnings or a Fed decision', `${draft.event_buyback_pct}% kept`, false, <>
            <Range label="Buy back target before earnings or a Fed decision" min={30} max={draft.profit_capture_target_pct} step={5} value={draft.event_buyback_pct}
              onChange={v => set('event_buyback_pct', v)} />
            <p className="mt-2 text-13 text-muted">Buying back a little earlier avoids holding through the jump these events can cause.</p>
          </>)}
          {rule('split', 'Income / balanced split', `${incomePct} / ${100 - incomePct}`, false, <>
            <input type="range" className="range" aria-label="Share of contracts sold as income picks" min={0} max={100} step={10} value={incomePct}
              onChange={e => set('income_weight', Number(e.target.value) / 100)} />
            <p className="mt-2 text-13 text-muted">Income picks pay more; balanced picks leave more room for the stock to rise. Each stock is split on its own; calls already open stay as they are.</p>
            {holdings.length > 0 && (
              <ul className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5">
                {holdings.map(h => {
                  const [inc, bal] = splitContracts(h.total_contracts, draft.income_weight)
                  return <li key={h.ticker} className="flex justify-between gap-3 text-13"><span className="font-semibold">{h.ticker}</span><span className="text-fg-2">{inc} · {bal}</span></li>
                })}
              </ul>
            )}
          </>)}
          {rule('reserve', 'Set aside for buybacks', `${reservePct}% of premium`, false, <>
            <Range label="Part of each premium set aside, percent" min={0} max={50} step={5} value={reservePct} onChange={v => set('buyback_budget_pct', v / 100)} />
            <p className="mt-2 text-13 text-muted">On a $500 premium you keep {money(500 * (1 - reservePct / 100), 0)} and set aside {money(500 * reservePct / 100, 0)} for buying back early.</p>
          </>)}
        </ul>
      </Section>

      <div className="mt-10"><AlertsSection /></div>

      <Section id="broker-h" title="Broker">
        <div className="flex items-center justify-between gap-4 border-b border-line py-3">
          <label htmlFor="commission" className="text-15 text-fg-2">Commission per contract</label>
          <Field id="commission" className="w-32 shrink-0" prefix="$" type="text" inputMode="decimal" maxLength={5}
            inputClassName="text-right font-semibold" value={commText}
            onChange={e => {
              // dollars and cents only: "0.65", ".5", "1"
              const text = e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1').replace(/^0+(?=\d)/, '')
              setCommText(text)
              set('commission_per_contract', text === '' || text === '.' ? 0 : Number(text))
            }} />
        </div>
        <p className={`mt-2 text-13 ${commErr ? 'text-loss' : 'text-muted'}`}>{commErr ? 'Use $0 to $10.' : 'Most brokers charge nothing for options. At $0 the fee boxes stay hidden.'}</p>
      </Section>

      <Section id="look-h" title="Appearance">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-3">
          <span className="text-15 text-fg-2">Theme</span>
          <Segmented label="Theme" options={APPEARANCE} value={preference} onChange={setPreference} className="w-full sm:w-[300px]" />
        </div>
        <p className="mt-2 text-13 text-muted">System follows your device's light or dark setting. Saved on this device.</p>
      </Section>

      <Section id="data-h" title="Your data">
        <ul>
          <li className="flex items-center justify-between gap-4 border-b border-line py-3">
            <div><div className="text-15">Holdings</div><div className="text-13 text-muted">{plural(holdings.length, 'stock')}</div></div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={exportHoldings} disabled={exporting}><Download size={15} strokeWidth={2} /> Download CSV</button>
          </li>
          <li className="flex items-center justify-between gap-4 border-b border-line py-3">
            <div><div className="text-15">Trades</div><div className="text-13 text-muted">{plural(positions.length, 'call')}, open and closed</div></div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={exportPositions} disabled={exporting}><Download size={15} strokeWidth={2} /> Download CSV</button>
          </li>
        </ul>
      </Section>

      {authRequired && (
        <Section id="account-h" title="Account">
          <div className="flex items-center justify-between gap-4 border-b border-line py-3">
            <span className="text-15 text-fg-2">Signed in on this device</span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={logout}><LogOut size={15} strokeWidth={2} /> Log out</button>
          </div>
        </Section>
      )}

      {/* Save bar: only while there are changes to save (or an error to show) */}
      {(dirty || error || saving) && (
        <div role="region" aria-label="Unsaved changes"
          className="sticky bottom-[calc(80px+env(safe-area-inset-bottom))] z-30 mt-8 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-card border border-line-2 bg-sheet py-2 pl-5 pr-2 shadow-bar md:bottom-4 md:rounded-full">
          <span className="text-15">{error ? <span className="text-loss">{error}</span> : invalid ? <span className="text-loss">Fix the highlighted rule first</span> : 'You have unsaved changes'}</span>
          <div className="flex gap-2">
            <button type="button" className="btn btn-secondary btn-sm min-h-11" onClick={discard} disabled={!dirty || saving}>Discard</button>
            <button type="button" className="btn btn-primary btn-sm min-h-11 px-5" onClick={handleSave} disabled={!dirty || saving || invalid}>
              {saving ? <><Spinner className="h-3.5 w-3.5" /> Saving…</> : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
