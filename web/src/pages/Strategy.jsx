// src/pages/Strategy.jsx — your covered call strategy, saved to the database
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, RotateCcw, Download } from 'lucide-react'
import { getStrategy, saveStrategy, getPortfolio, getAllPositions, getPerformance, apiError } from '../api/client'
import PageHeader from '../components/PageHeader'
import { useToast } from '../context/ToastContext'
import InfoTip from '../components/InfoTip'
import AlertsSection from '../components/AlertsSection'
import { DEFAULT_STRATEGY, buybackPrice, splitContracts } from '../lib/strategy'
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

// A small whole-number box; empty or invalid shows as '' and is caught before saving
function NumberBox({ id, value, onChange, width = 72, suffix, invalid }) {
  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <input id={id} className="input" type="text" inputMode="numeric" autoComplete="off" maxLength={3}
        value={Number.isFinite(value) ? String(value) : ''} aria-invalid={invalid}
        onChange={e => {
          const t = e.target.value.replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '')
          onChange(t === '' ? NaN : Number(t))
        }}
        style={{ width, paddingRight: suffix ? 28 : undefined, textAlign: 'right', ...(invalid ? { borderColor: 'var(--red)' } : {}) }} />
      {suffix && <span aria-hidden="true" style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}>{suffix}</span>}
    </span>
  )
}

// 1000 -> '1000', 0 -> '' (empty box shows the placeholder)
const goalToText = g => (g > 0 ? String(Math.round(g)) : '')

export default function Strategy() {
  const toast = useToast()
  const [saved, setSaved]       = useState(null)    // what the server has
  const [draft, setDraft]       = useState(null)    // what's on screen
  const [goalText, setGoalText] = useState('')      // goal box exactly as typed ('' = no goal)
  const [loadError, setLoadError] = useState(null)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState(null)
  const [positions, setPositions] = useState([])
  const [holdings, setHoldings] = useState([])
  const [exporting, setExporting] = useState(false)
  const [perf, setPerf]         = useState(null)    // /performance summary + months

  useEffect(() => {
    getStrategy()
      .then(r => { const s = { ...DEFAULT_STRATEGY, ...r.data }; setSaved(s); setDraft(s); setGoalText(goalToText(s.monthly_goal)) })
      .catch(e => setLoadError(apiError(e, 'Could not load your strategy. Is the API running?')))
    getAllPositions().then(r => setPositions(r.data)).catch(() => {})
    getPortfolio().then(r => setHoldings(r.data)).catch(() => {})
    getPerformance().then(r => setPerf(r.data)).catch(() => {})
  }, [])

  // The goal tracks what you KEPT this month: the same number as the
  // Performance page (calls that finished this month, net of buybacks and
  // fees). Calls sold this month that are still open count once they finish.
  const monthKey  = perf?.summary.month
  const monthName = monthKey
    ? new Date(Number(monthKey.slice(0, 4)), Number(monthKey.slice(5, 7)) - 1, 1).toLocaleDateString('en-CA', { month: 'long' })
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
      setSaved(s); setDraft(s); setGoalText(goalToText(s.monthly_goal))
      toast('Strategy saved. It applies to your next scan and price check.')
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
  const dMin = Math.round(draft.delta_min * 100), dMax = Math.round(draft.delta_max * 100)
  const deltaErr = !(dMin >= 5 && dMax <= 60 && dMin < dMax)
  const dteErr = !(draft.min_dte >= 1 && draft.max_dte <= 120 && draft.min_dte < draft.max_dte)
  const invalid = deltaErr || dteErr

  return (
    <div className="fade-up">
      <PageHeader
        title="Strategy"
        subtitle="How the app splits your trades and when it tells you to buy back. Changes apply to every stock."
        actions={
          <button className="link-btn" style={{ color: 'var(--text-muted)', fontSize: 13 }}
            onClick={() => setDraft(d => ({ ...DEFAULT_STRATEGY, monthly_goal: d.monthly_goal }))}>
            <RotateCcw size={13} strokeWidth={1.75} /> Reset rules to defaults
          </button>
        }
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* 0. Which calls to sell */}
        <Section title="Which calls to sell" tip={TERMS.delta} hint="The Scanner only considers calls in this range. Balanced picks sit near the low end; income picks go only as high as your monthly goal needs.">
          <div className="sell-rules">
            <div>
              <div className="label" id="delta-label">Chance of being called (delta)</div>
              <div className="range-pair" role="group" aria-labelledby="delta-label">
                <NumberBox id="delta-min" value={dMin} suffix="%" invalid={deltaErr} onChange={v => set('delta_min', v / 100)} />
                <span className="muted">to</span>
                <NumberBox id="delta-max" value={dMax} suffix="%" invalid={deltaErr} onChange={v => set('delta_max', v / 100)} />
              </div>
              {deltaErr && <div style={{ color: 'var(--red)', fontSize: 12.5, marginTop: 6 }}>Use a range between 5% and 60%, low to high.</div>}
            </div>
            <div>
              <div className="label" id="dte-label">Expiring in</div>
              <div className="range-pair" role="group" aria-labelledby="dte-label">
                <NumberBox id="dte-min" value={draft.min_dte} invalid={dteErr} onChange={v => set('min_dte', v)} />
                <span className="muted">to</span>
                <NumberBox id="dte-max" value={draft.max_dte} invalid={dteErr} onChange={v => set('max_dte', v)} />
                <span className="muted">days</span>
              </div>
              {dteErr && <div style={{ color: 'var(--red)', fontSize: 12.5, marginTop: 6 }}>Use 1 to 120 days, shortest first.</div>}
            </div>
          </div>
          <div className="hint" style={{ marginTop: 12 }}>
            When earnings, a Fed meeting, or earnings from big companies in the same industry come before expiry, picks stay near {dMin}%.
          </div>
        </Section>

        <div className="grid-2">
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
          <Section title="When to buy back" tip={TERMS.profit} hint="Positions shows “Buy back now” once a call's price falls to where you'd keep this much of its premium.">
            <div style={{ fontSize: 15, marginBottom: 10 }}>
              Buy back at <strong style={{ color: 'var(--green)' }}>{draft.profit_capture_target_pct}%</strong> of premium kept
            </div>
            <Slider label="Buyback target" value={draft.profit_capture_target_pct} min={50} max={95} step={5}
              onChange={v => setDraft(d => ({ ...d, profit_capture_target_pct: v, event_buyback_pct: Math.min(d.event_buyback_pct, v) }))} />
            <div className="hint" style={{ marginTop: 10 }}>
              Example: sold at $0.34 a share → buy back at {money(buybackPrice(0.34, draft.profit_capture_target_pct))} or less.
              Options trade in whole cents, so this is the closest cent to {draft.profit_capture_target_pct}%
              ({((1 - buybackPrice(0.34, draft.profit_capture_target_pct) / 0.34) * 100).toFixed(1)}% kept).
            </div>
            <div style={{ fontSize: 15, margin: '18px 0 10px' }}>
              Before earnings or a Fed meeting: <strong style={{ color: 'var(--green)' }}>{draft.event_buyback_pct}%</strong>
            </div>
            <Slider label="Buyback target before earnings or a Fed meeting" value={draft.event_buyback_pct} min={30} max={draft.profit_capture_target_pct} step={5} onChange={v => set('event_buyback_pct', v)} />
            <div className="hint" style={{ marginTop: 10 }}>
              Buying back a little earlier avoids holding through the jump these events can cause.
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
          <Section title="Monthly income goal" hint="A target for the premium you keep each month, after buybacks and fees. Leave at 0 to turn it off.">
            <label className="label" htmlFor="goal">Premium you'd like to keep each month</label>
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
            {draft.monthly_goal > 0 && perf && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 8, gap: 12 }}>
                  <span>Kept in {monthName}: <strong style={{ color: monthKept < 0 ? 'var(--red)' : 'var(--green)' }}>{money(monthKept)}</strong> of {money(draft.monthly_goal, 0)}</span>
                  <span className="mono" style={{ color: goalPct >= 100 ? 'var(--green)' : 'var(--text-dim)' }}>{goalPct}%</span>
                </div>
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${Math.min(goalPct, 100)}%`, background: goalPct >= 100 ? 'linear-gradient(90deg, #1fc99a, #34edb3)' : undefined }} />
                </div>
                <div className="hint" style={{ marginTop: 8 }}>
                  {goalPct >= 100 ? 'Goal reached this month.' : `${money(Math.max(draft.monthly_goal - monthKept, 0))} to go`}
                  {monthRow && <> · {plural(monthRow.calls, 'call')} finished: {money(monthRow.premium)} collected
                    {monthRow.buybacks > 0 && <> − {money(monthRow.buybacks)} bought back</>}
                    {monthRow.fees > 0 && <> − {money(monthRow.fees)} fees</>}</>}
                  {monthRow?.missing_costs > 0 && (
                    <span style={{ color: 'var(--amber)' }}> · {plural(monthRow.missing_costs, 'buyback')} without a cost (<Link to="/positions?tab=history&scope=all" style={{ color: 'inherit' }}>add it</Link>)</span>
                  )}
                </div>
                {openPremium > 0 && (
                  <div className="hint" style={{ marginTop: 4 }}>
                    Plus {money(openPremium)} from {plural(openSoldThisMonth.length, 'call')} sold this month that {openSoldThisMonth.length === 1 ? 'is' : 'are'} still open. It counts once {openSoldThisMonth.length === 1 ? 'it finishes' : 'they finish'}.
                  </div>
                )}
                <div className="hint" style={{ marginTop: 4 }}>Same numbers as the <Link to="/performance" style={{ color: 'var(--accent-light)' }}>Performance</Link> page.</div>
              </>
            )}
          </Section>
        </div>

        {/* 5. Alerts */}
        <AlertsSection />

        {/* 6. Data */}
        <Section title="Your data" hint="Download a copy of everything saved in the app, as spreadsheet-friendly CSV files.">
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button className="btn-secondary" onClick={exportHoldings} disabled={exporting}><Download size={15} /> Holdings ({plural(holdings.length, 'stock')})</button>
            <button className="btn-secondary" onClick={exportPositions} disabled={exporting}><Download size={15} /> Trades ({plural(positions.length, 'call')}, open and closed)</button>
          </div>
        </Section>
      </div>

      {/* Save bar: only while there are changes to save (or an error to show) */}
      {(dirty || error || saving) && (
      <div className="save-bar">
        <span className="hint">You have unsaved changes</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          {error && <span style={{ color: 'var(--red)', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}><AlertTriangle size={14} /> {error}</span>}
          <button className="btn-secondary" onClick={() => { setDraft(saved); setGoalText(goalToText(saved.monthly_goal)); setError(null) }} disabled={!dirty || saving}>Discard</button>
          {invalid && <span style={{ color: 'var(--red)', fontSize: 13 }}>Fix the highlighted boxes first</span>}
          <button className="btn-primary" onClick={handleSave} disabled={!dirty || saving || invalid}>
            {saving ? <><span className="spinner" /> Saving…</> : 'Save strategy'}
          </button>
        </div>
      </div>
      )}
    </div>
  )
}
