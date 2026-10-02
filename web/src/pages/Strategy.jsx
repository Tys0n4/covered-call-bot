// src/pages/Strategy.jsx — your covered call strategy, saved to the database
import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, RotateCcw, Download } from 'lucide-react'
import { getStrategy, saveStrategy, getPortfolio, getAllPositions, apiError } from '../api/client'
import PageHeader from '../components/PageHeader'
import InfoTip from '../components/InfoTip'
import { DEFAULT_STRATEGY, splitContracts } from '../lib/strategy'
import { TERMS } from '../lib/terms'
import { money, plural } from '../lib/format'

function Section({ title, tip, children, hint }) {
  return (
    <div className="card">
      <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{title} {tip && <InfoTip text={tip} />}</div>
      {hint && <div className="hint" style={{ marginBottom: 18 }}>{hint}</div>}
      {children}
    </div>
  )
}

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

function Slider({ value, onChange, min, max, step, label }) {
  return (
    <input type="range" className="slider" min={min} max={max} step={step} value={value} aria-label={label}
      onChange={e => onChange(Number(e.target.value))}
      style={{ '--fill': `${((value - min) / (max - min)) * 100}%` }} />
  )
}

// 1000 -> '1000', 0 -> '' (empty box shows the placeholder)
const goalToText = g => (g > 0 ? String(Math.round(g)) : '')

export default function Strategy() {
  const [saved, setSaved]       = useState(null)    // what the server has
  const [draft, setDraft]       = useState(null)    // what's on screen
  const [goalText, setGoalText] = useState('')      // goal box exactly as typed ('' = no goal)
  const [loadError, setLoadError] = useState(null)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState(null)
  const [justSaved, setJustSaved] = useState(false)
  const [positions, setPositions] = useState([])
  const [holdings, setHoldings] = useState([])
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    getStrategy()
      .then(r => { const s = { ...DEFAULT_STRATEGY, ...r.data }; setSaved(s); setDraft(s); setGoalText(goalToText(s.monthly_goal)) })
      .catch(e => setLoadError(apiError(e, 'Could not load your strategy. Is the API running?')))
    getAllPositions().then(r => setPositions(r.data)).catch(() => {})
    getPortfolio().then(r => setHoldings(r.data)).catch(() => {})
  }, [])

  // Premium from calls sold this calendar month (open or closed)
  const now = new Date()
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const monthName = now.toLocaleDateString('en-CA', { month: 'long' })
  const thisMonth = positions.filter(p => (p.opened_at || '').startsWith(monthKey))
  const monthPremium = thisMonth.reduce((sum, p) => sum + p.premium_total, 0)
  const monthCount = thisMonth.length
  const goalPct = draft?.monthly_goal > 0 ? Math.round((monthPremium / draft.monthly_goal) * 100) : 0

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
      downloadCsv('trades.csv', ['id', 'ticker', 'allocation_type', 'status', 'expiry', 'strike', 'contracts', 'entry_price', 'premium_total', 'opened_at', 'closed_at'], r.data)
    } finally { setExporting(false) }
  }

  const set = (k, v) => { setDraft(d => ({ ...d, [k]: v })); setJustSaved(false) }
  const dirty = saved && draft && JSON.stringify(saved) !== JSON.stringify(draft)

  const handleSave = async () => {
    setSaving(true); setError(null)
    try {
      const r = await saveStrategy(draft)
      const s = { ...DEFAULT_STRATEGY, ...r.data }
      setSaved(s); setDraft(s); setGoalText(goalToText(s.monthly_goal)); setJustSaved(true)
    } catch (e) {
      setError(apiError(e))
    } finally {
      setSaving(false)
    }
  }

  if (loadError) {
    return (
      <div className="fade-up">
        <PageHeader title="Strategy" subtitle="How the app picks trades and when it tells you to buy back." />
        <div className="callout callout-red"><AlertTriangle size={18} strokeWidth={1.75} /> {loadError}</div>
      </div>
    )
  }
  if (!draft) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}><div className="spinner" style={{ width: 36, height: 36 }} /></div>
  }

  const incomePct = Math.round(draft.income_weight * 100)
  const reservePct = Math.round(draft.buyback_budget_pct * 100)

  return (
    <div className="fade-up">
      <PageHeader
        title="Strategy"
        subtitle="How the app splits your trades and when it tells you to buy back. Changes apply to every stock."
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {/* 1. Split */}
          <Section title="Income vs. balanced split" tip={`${TERMS.income} ${TERMS.balanced}`} hint="How your contracts are divided when the app recommends a trade.">
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, marginBottom: 10 }}>
              <span><strong style={{ color: 'var(--accent-light)' }}>{incomePct}%</strong> income</span>
              <span><strong style={{ color: 'var(--blue)' }}>{100 - incomePct}%</strong> balanced</span>
            </div>
            <Slider label="Income share" value={incomePct} min={0} max={100} step={10} onChange={v => set('income_weight', v / 100)} />
            {holdings.length > 0 ? (
              <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {holdings.map(h => {
                  const [inc, bal] = splitContracts(h.total_contracts, draft.income_weight)
                  return (
                    <div key={h.ticker} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 14, background: 'rgba(0,0,0,0.18)', borderRadius: 8, padding: '8px 12px' }}>
                      <span><strong className="mono">{h.ticker}</strong> <span className="muted">({plural(h.total_contracts, 'contract')})</span></span>
                      <span><strong style={{ color: 'var(--accent-light)' }}>{inc}</strong> income · <strong style={{ color: 'var(--blue)' }}>{bal}</strong> balanced</span>
                    </div>
                  )
                })}
                <div className="hint">Each stock is split on its own. Calls already open stay as they are; new trades fill the gap.</div>
              </div>
            ) : (
              <div className="hint" style={{ marginTop: 10 }}>Add a stock on the Dashboard to see how its contracts would be split.</div>
            )}
          </Section>

          {/* 2. Buyback target */}
          <Section title="When to buy back" tip={TERMS.profit} hint="Positions shows “Buy back now” once you've kept this much of a call's premium.">
            <div style={{ fontSize: 15, marginBottom: 10 }}>
              Buy back at <strong style={{ color: 'var(--green)' }}>{draft.profit_capture_target_pct}%</strong> of premium kept
            </div>
            <Slider label="Buyback target" value={draft.profit_capture_target_pct} min={50} max={95} step={5} onChange={v => set('profit_capture_target_pct', v)} />
            <div className="hint" style={{ marginTop: 10 }}>
              Example: sold for $500 → buy back once it costs {money(500 * (1 - draft.profit_capture_target_pct / 100), 0)} or less.
            </div>
          </Section>

          {/* 3. Buyback reserve */}
          <Section title="Buyback reserve" tip={TERMS.buyback} hint="Part of each premium you set aside for buying calls back early.">
            <div style={{ fontSize: 15, marginBottom: 10 }}>
              Set aside <strong>{reservePct}%</strong> of each premium
            </div>
            <Slider label="Buyback reserve" value={reservePct} min={0} max={50} step={5} onChange={v => set('buyback_budget_pct', v / 100)} />
            <div className="hint" style={{ marginTop: 10 }}>
              Example: on a $500 premium you keep {money(500 * (1 - reservePct / 100), 0)} and reserve {money(500 * reservePct / 100, 0)}.
            </div>
          </Section>

          {/* 4. Monthly goal */}
          <Section title="Monthly income goal" hint="Set a premium target for each month and track it here. Leave at 0 to turn it off.">
            <label className="label" htmlFor="goal">Premium you'd like to collect each month</label>
            <div style={{ position: 'relative', maxWidth: 220, marginBottom: 16 }}>
              <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}>$</span>
              <input id="goal" className="input" type="text" inputMode="numeric" autoComplete="off" placeholder="0" maxLength={7}
                value={goalText}
                onChange={e => {
                  // whole dollars only; drop leading zeros so "0" + "1000" becomes "1000"
                  const text = e.target.value.replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '')
                  setGoalText(text)
                  set('monthly_goal', text === '' ? 0 : Number(text))
                }}
                style={{ paddingLeft: 28 }} />
            </div>
            {draft.monthly_goal > 0 && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 8 }}>
                  <span>{monthName}: <strong style={{ color: 'var(--green)' }}>{money(monthPremium)}</strong> of {money(draft.monthly_goal, 0)}</span>
                  <span className="mono" style={{ color: goalPct >= 100 ? 'var(--green)' : 'var(--text-dim)' }}>{goalPct}%</span>
                </div>
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${Math.min(goalPct, 100)}%`, background: goalPct >= 100 ? 'linear-gradient(90deg, #1fc99a, #34edb3)' : undefined }} />
                </div>
                <div className="hint" style={{ marginTop: 8 }}>
                  {goalPct >= 100 ? 'Goal reached this month.' : `${money(Math.max(draft.monthly_goal - monthPremium, 0))} to go`} · from {plural(monthCount, 'call')} sold since {monthName} 1
                </div>
              </>
            )}
          </Section>
        </div>

        {/* 5. Data */}
        <Section title="Your data" hint="Download a copy of everything saved in the app, as spreadsheet-friendly CSV files.">
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button className="btn-secondary" onClick={exportHoldings} disabled={exporting}><Download size={15} /> Holdings ({plural(holdings.length, 'stock')})</button>
            <button className="btn-secondary" onClick={exportPositions} disabled={exporting}><Download size={15} /> Trades ({plural(positions.length, 'call')}, open and closed)</button>
          </div>
        </Section>
      </div>

      {/* Save bar */}
      <div className="save-bar">
        <button className="link-btn" style={{ color: 'var(--text-muted)', fontSize: 13 }} onClick={() => { setDraft(d => ({ ...DEFAULT_STRATEGY, monthly_goal: d.monthly_goal })); setJustSaved(false) }}>
          <RotateCcw size={13} strokeWidth={1.75} /> Reset rules to defaults
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {error && <span style={{ color: 'var(--red)', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}><AlertTriangle size={14} /> {error}</span>}
          {!error && justSaved && !dirty && <span style={{ color: 'var(--green)', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}><CheckCircle2 size={15} /> Saved</span>}
          {!error && dirty && <span className="hint">You have unsaved changes</span>}
          <button className="btn-secondary" onClick={() => { setDraft(saved); setGoalText(goalToText(saved.monthly_goal)); setError(null) }} disabled={!dirty || saving}>Discard</button>
          <button className="btn-primary" onClick={handleSave} disabled={!dirty || saving}>
            {saving ? <><span className="spinner" /> Saving…</> : 'Save strategy'}
          </button>
        </div>
      </div>
    </div>
  )
}
