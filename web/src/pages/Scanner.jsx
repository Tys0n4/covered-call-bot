// src/pages/Scanner.jsx — find a covered call to sell on one of your stocks
import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Check, RefreshCw, RotateCcw, ScanLine } from 'lucide-react'
import { runScan, savePositions, apiError } from '../api/client'
import { useStrategy, chargesCommission } from '../lib/useStrategy'
import { useTicker } from '../context/TickerContext'
import { usePageTitle } from '../components/PageHeader'
import InfoTip from '../components/InfoTip'
import ServerDown from '../components/ServerDown'
import EmptyState, { AddStockLink } from '../components/EmptyState'
import OptionsTable, { eventsText } from '../components/OptionsTable'
import PremiumCheck, { GoalCheck } from '../components/PremiumCheck'
import StockChips from '../components/StockChips'
import { Dot, Field, MoneyField, Spinner } from '../components/ui'
import { TERMS } from '../lib/terms'
import { fmtDate, money, plural, strike } from '../lib/format'
import { moneyValue, splitFees } from '../lib/pnl'

// The expiry window and delta range come from your strategy (Strategy page)
const DEFAULT_CONFIG = {
  min_strike_pct: 0, min_premium: 0.05,
  min_volume: 10, min_open_interest: 50,
  exclude_below_cost: false,
  avoid_earnings: false,
}

// On/off filters (checkboxes), saved alongside the number boxes
const TOGGLES = [
  { name: 'exclude_below_cost', label: 'Skip strikes below my average cost', tip: TERMS.belowCost },
  { name: 'avoid_earnings',     label: 'Skip expiries that span earnings',  tip: TERMS.earnings },
]

const STORAGE_KEY = 'scanner_config'

// The filter boxes: what each accepts and the allowed range
const FIELDS = [
  { name: 'min_premium',       label: 'Min. premium per share', tip: TERMS.minPremium,  kind: 'dec', min: 0.01, max: 1000, prefix: '$' },
  { name: 'min_strike_pct',    label: 'Min. distance above price', tip: TERMS.minStrike, kind: 'dec', min: 0, max: 0.5, pct: true },
  { name: 'min_volume',        label: 'Min. daily volume',      tip: TERMS.volume,      kind: 'int', min: 1,    max: 1000000 },
  { name: 'min_open_interest', label: 'Min. open interest',     tip: TERMS.openInt,     kind: 'int', min: 1,    max: 1000000 },
]
// Fields with pct: true are typed as percentages (20 = 20%) but stored and
// sent to the API as fractions (0.20), with min/max in stored units.
const toShown = (f, v) => (f.pct ? String(Math.round(v * 10000) / 100) : String(v))
const fromShown = (f, text) => (f.pct ? Number(text) / 100 : Number(text))
const shownLimit = (f, v) => (f.pct ? `${Math.round(v * 100)}%` : v.toLocaleString())

const inRange = (f, v) => Number.isFinite(v) && v >= f.min && v <= f.max && (f.kind !== 'int' || Number.isInteger(v))

// Saved filters from this browser. Anything missing or invalid falls back to the default.
function loadConfig() {
  let saved
  try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {} } catch { saved = {} }
  const config = { ...DEFAULT_CONFIG }
  for (const f of FIELDS) {
    const v = Number(saved[f.name])
    if (saved[f.name] !== null && saved[f.name] !== '' && inRange(f, v)) config[f.name] = v
  }
  for (const t of TOGGLES) config[t.name] = saved[t.name] === true
  return config
}

const toForm = config => ({
  ...Object.fromEntries(FIELDS.map(f => [f.name, toShown(f, config[f.name])])),
  ...Object.fromEntries(TOGGLES.map(t => [t.name, !!config[t.name]])),
})

// Turn the typed text into numbers, with a plain message for each problem
function parseForm(form) {
  const values = Object.fromEntries(TOGGLES.map(t => [t.name, !!form[t.name]])), errors = {}
  for (const f of FIELDS) {
    const text = form[f.name]
    const v = fromShown(f, text)
    if (text === '' || text === '.') errors[f.name] = 'Enter a number'
    else if (!inRange(f, v)) errors[f.name] = `Must be ${f.kind === 'int' ? 'a whole number ' : ''}between ${shownLimit(f, f.min)} and ${shownLimit(f, f.max)}`
    else values[f.name] = v
  }
  return { values, errors, valid: Object.keys(errors).length === 0 }
}

// Keep only what a box can hold: digits, plus one dot for decimals.
// Leading zeros are dropped so typing over a 0 replaces it.
function cleanInput(raw, kind) {
  if (kind === 'int') return raw.replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '')
  let t = raw.replace(/[^0-9.]/g, '')
  const dot = t.indexOf('.')
  if (dot !== -1) t = t.slice(0, dot + 1) + t.slice(dot + 1).replace(/\./g, '')
  return t.replace(/^0+(?=\d)/, '')
}

// One heads-up from the scan: its first sentence carries the point, the rest is behind "More"
function HeadsUp({ text }) {
  const [open, setOpen] = useState(false)
  const m = /^(.+?[.!?])\s+(\S[\s\S]*)$/.exec(text)
  return (
    <li className="flex items-start gap-2 text-15 text-fg-2">
      <Dot tone="amber" className="mt-2" />
      <span>
        {m ? m[1] : text}
        {m && (open ? <> {m[2]}</> : <> <button type="button" className="link link-quiet" onClick={() => setOpen(true)}>More</button></>)}
      </span>
    </li>
  )
}

// The last scan of each stock stays on screen when you come back to it
const lastScans = new Map()   // ticker -> { result, fills, fees, saved, at }
const clock = iso => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
const wide = () => window.matchMedia?.('(min-width: 768px)').matches

export default function Scanner() {
  usePageTitle('Scanner')
  const { selected, tickers, selectTicker, loaded, loadError, refresh } = useTicker()
  const [form, setForm]       = useState(() => toForm(loadConfig()))   // boxes, exactly as typed
  const [scan, setScan]       = useState(() => lastScans.get(selected) || null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)
  const [saving, setSaving]   = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [tableOpen, setTableOpen] = useState(wide)
  const strategy = useStrategy()          // delta range, expiry window and commission
  const showFees = chargesCommission(strategy)

  const { values: config, errors: fieldErrors, valid: filtersValid } = parseForm(form)

  // Remember filters in this browser, but only once every box is valid
  useEffect(() => {
    if (!filtersValid) return
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(config)) } catch { /* storage unavailable */ }
  }, [form]) // eslint-disable-line react-hooks/exhaustive-deps

  // Switching stocks shows that stock's last scan, if there is one
  const [scannedFor, setScannedFor] = useState(selected)
  if (scannedFor !== selected) {
    setScannedFor(selected); setScan(lastScans.get(selected) || null); setError(null)
  }
  const update = patch => setScan(s => {
    const next = { ...s, ...patch }
    lastScans.set(next.result.ticker, next)
    return next
  })

  const result = scan?.result
  const fills = scan?.fills || []
  const feesText = scan?.fees ?? ''
  const saved = !!scan?.saved

  const updateField = (k, text) => setForm(f => ({ ...f, [k]: text }))

  const handleScan = async () => {
    if (!selected || !filtersValid) return
    setLoading(true); setError(null)
    try {
      const res = await runScan({ ...config, ticker: selected })
      const next = {
        result: res.data,
        // Empty until you enter your broker's fills (or choose the quotes), so a guess is never saved as a trade
        fills: res.data.planned_positions.map(() => ''),
        // Your usual commission for these contracts; edit it if your broker charged something else
        fees: res.data.estimated_fees > 0 ? res.data.estimated_fees.toFixed(2) : '',
        saved: false,
        at: new Date().toISOString(),
      }
      lastScans.set(res.data.ticker, next)
      setScan(next)
    } catch (e) {
      setError(apiError(e, 'Scan failed. Is the API running?'))
    } finally {
      setLoading(false)
    }
  }

  const fillValues = fills.map(moneyValue)
  const fillsValid = fillValues.length > 0 && fillValues.every(v => v != null && v > 0)
  const fillQuotes = () => update({ fills: (scan?.result.planned_positions || []).map((p, i) => fills[i] || p.entry_price.toFixed(2)) })

  const handleSave = async () => {
    if (!result?.planned_positions || !fillsValid) return
    const legs = result.planned_positions
    const fees = splitFees(moneyValue(feesText) || 0, legs.map(p => p.contracts))
    const payload = legs.map((p, i) => ({
      ticker: result.ticker, expiry: p.expiry, strike: p.strike,
      contracts: p.contracts, entry_price: fillValues[i],
      allocation_type: p.allocation_type, fees: fees[i],
    }))
    setSaving(true)
    try { await savePositions(payload); update({ saved: true }); refresh().catch(() => {}) }
    catch (e) { setError(apiError(e, 'Could not save the trade. Is the API running?')) }
    finally { setSaving(false) }
  }

  const holding = tickers.find(t => t.ticker === selected)
  const planned = result?.planned_positions || []
  const contracts = planned.reduce((s, p) => s + p.contracts, 0)
  // Market closed (or opened under 15 min ago, while the delayed quotes catch up):
  // results use last-session prices, so saving waits for live prices
  const lastPrices = result?.quotes_live === false
  const liveAt = lastPrices && result?.quotes_live_at ? clock(result.quotes_live_at) : null
  const nextOpen = result?.next_market_open
    ? new Date(result.next_market_open).toLocaleString('en-US', { weekday: 'long', hour: 'numeric', minute: '2-digit' })
    : null
  const optionFor = p => result?.candidates.find(c => c.expiry === p.expiry && c.strike === p.strike) || {}
  const picked = new Map(planned.map(p => [`${p.expiry}|${p.strike}`, 'Picked']))
  const fillTotal = planned.reduce((s, p, i) => s + (fillValues[i] || 0) * p.contracts * 100, 0) - (moneyValue(feesText) || 0)
  const reservePct = result && result.gross_premium > 0 ? Math.round((result.buyback_budget / result.gross_premium) * 100) : null
  const allEvents = planned.length > 0 && planned.every(p => eventsText(optionFor(p)))

  const rules = strategy
    ? [
        ['Chance of being called', `${Math.round(strategy.delta_min * 100)}–${Math.round(strategy.delta_max * 100)}%`],
        ['Expiring in', `${strategy.min_dte}–${strategy.max_dte} days`],
        ['Income / balanced', `${Math.round(strategy.income_weight * 100)} / ${100 - Math.round(strategy.income_weight * 100)}`],
        ['Set aside to buy back', `${Math.round(strategy.buyback_budget_pct * 100)}%`],
      ]
    : []
  const changed = FIELDS.filter(f => config[f.name] !== DEFAULT_CONFIG[f.name]).length + TOGGLES.filter(t => config[t.name]).length
  const filterSummary = !filtersValid
    ? 'One of the filters needs fixing before you can scan.'
    : `At least ${money(config.min_premium)} a share, ${config.min_volume.toLocaleString()} contracts traded today and ${config.min_open_interest.toLocaleString()} open.`
      + (config.min_strike_pct > 0 ? ` Strikes at least ${Math.round(config.min_strike_pct * 100)}% above the price.` : '')
      + (config.exclude_below_cost ? ' Strikes below your cost are skipped.' : '')
      + (config.avoid_earnings ? ' Expiries after earnings are skipped.' : '')

  const scanButton = (
    <button type="button" className="btn btn-primary" onClick={handleScan} disabled={loading || !filtersValid}>
      {loading ? <><Spinner /> Scanning…</> : <><ScanLine size={17} strokeWidth={2} /> Scan {selected}</>}
    </button>
  )

  return (
    <div className="page">
      <div className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-3 md:mb-8">
        <h1 className="page-title">Scanner</h1>
        {tickers.length > 0 && (
          <div className="order-last w-full md:order-none md:w-auto">
            <StockChips label="Stock to scan" free tickers={tickers} value={selected} onChange={selectTicker} />
          </div>
        )}
        {result && !loading && (
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-13 text-muted md:inline">Scanned {clock(scan.at)}</span>
            <button type="button" className="icon-btn -mr-2 md:hidden" onClick={handleScan} aria-label={`Scan ${selected} again`}>
              <RefreshCw size={19} strokeWidth={1.9} />
            </button>
            <button type="button" className="btn btn-secondary btn-sm hidden md:inline-flex" onClick={handleScan} disabled={!filtersValid}>
              <RefreshCw size={15} strokeWidth={2} /> Scan again
            </button>
          </div>
        )}
      </div>

      {!selected && loadError && <ServerDown onRetry={() => refresh().catch(() => {})} />}

      {!selected && loaded && !loadError && (
        <EmptyState icon={ScanLine} title="Add a stock to start scanning" action={<AddStockLink />}>
          The Scanner looks for covered calls on shares you own. Add a stock and how many shares you have, then come back here.
        </EmptyState>
      )}

      {selected && (
        <div className="md:grid md:grid-cols-[minmax(0,1fr)_300px] md:items-start md:gap-12">
          <div className="min-w-0">
            <p className="flex flex-wrap gap-x-5 gap-y-1 text-15 text-fg-2">
              {result && <span>{result.ticker} <strong className="font-semibold text-fg">{money(result.current_price)}</strong>{lastPrices ? ' at the last close' : ''}</span>}
              {holding && <span>{holding.shares.toLocaleString()} shares · avg {money(holding.avg_cost)}</span>}
              {result?.earnings_date && <span>Earnings {fmtDate(result.earnings_date)}</span>}
              {result?.ex_dividend_date && <span>Ex-dividend {fmtDate(result.ex_dividend_date)}</span>}
            </p>

            {error && <p role="alert" className="mt-5 flex items-start gap-2 text-15 text-loss"><Dot tone="loss" className="mt-2" />{error}</p>}

            {loading && (
              <div className="mt-10 flex items-center gap-4 rounded-card bg-surface p-6" role="status">
                <Spinner className="h-6 w-6 text-accent" />
                <div><div className="text-17 font-semibold">Checking {selected} options…</div><div className="text-13 text-muted">This usually takes 15–30 seconds.</div></div>
              </div>
            )}

            {!result && !loading && (
              <section aria-labelledby="ready-h" className="mt-8">
                <h2 id="ready-h" className="text-22 font-semibold tracking-title">Find a call to sell on {selected}</h2>
                <p className="mt-2 max-w-[560px] text-15 text-fg-2">
                  {strategy ? `Calls with a ${Math.round(strategy.delta_min * 100)}–${Math.round(strategy.delta_max * 100)}% chance of being called, expiring in ${strategy.min_dte}–${strategy.max_dte} days.` : 'Calls that fit your strategy.'}
                  {holding?.available === 0 ? ` Every ${selected} contract already has a call sold, so this is just to look.` : ''}
                </p>
                <div className="mt-6">{scanButton}</div>
                <ol className="mt-10 grid gap-4 border-t border-line pt-6 md:grid-cols-3">
                  {[['Scan', 'Calls on your shares that match your rules and filters.'], ['Pick', 'One recommended trade, split between income and balanced calls.'], ['Track', 'Save it, then follow it on Positions until you close it.']].map(([t, d], i) => (
                    <li key={t} className="flex gap-3">
                      <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface text-13 font-semibold text-fg-2">{i + 1}</span>
                      <span><span className="block text-15 font-semibold">{t}</span><span className="block text-13 text-muted">{d}</span></span>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            {result && !loading && (
              <>
                <div className="mt-4"><PremiumCheck check={result.premium_check} ticker={result.ticker} /></div>

                {planned.length > 0 && (
                  <section aria-labelledby="rec-h" className="mt-8">
                    <h2 id="rec-h" className="text-15 font-medium text-fg-2">Recommended trade</h2>
                    <div className="hero-num mt-1.5">{money(result.gross_premium)}</div>
                    <div className="mt-2.5 flex flex-wrap items-center gap-x-1.5 text-15 text-fg-2">
                      <span>{lastPrices ? 'Estimated at last prices for' : 'You collect today for'} selling {plural(contracts, `${result.ticker} call`)}</span>
                      {result.goal_check && <><span aria-hidden="true">·</span><GoalCheck check={result.goal_check} deltaMax={result.delta_max} /></>}
                    </div>

                    <ul className="mt-6 border-t border-line">
                      {planned.map((p, i) => {
                        const o = optionFor(p)
                        const ev = eventsText(o, result.ticker)
                        return (
                          <li key={i} className="flex flex-wrap items-center gap-x-6 gap-y-1 border-b border-line py-4">
                            <div className="w-full md:w-[110px]">
                              <div className="text-13 font-semibold text-fg-2 md:text-15 md:text-fg">{p.allocation_type}</div>
                              <div className="hidden text-13 text-muted md:block">{p.allocation_type === 'Income' ? 'more premium' : 'more room to rise'}</div>
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="text-17 font-semibold">{p.contracts} × {strike(p.strike)} call</div>
                              <div className="text-13 text-muted">
                                {fmtDate(p.expiry)} · {plural(o.dte ?? 0, 'day')}{o.delta != null ? ` · ${Math.round(o.delta * 100)}% chance of being called` : ''}
                                {p.below_cost_basis && <span className="text-amber"> · below your cost</span>}
                              </div>
                              {ev && <div className="flex items-center gap-1.5 text-13 text-muted"><Dot tone="amber" />Expires {ev}</div>}
                            </div>
                            <div className="text-17 font-semibold text-accent">+{money(p.premium_total)}</div>
                          </li>
                        )
                      })}
                    </ul>
                    <p className="mt-3 text-13 text-muted">
                      Of the {money(result.gross_premium)}, {money(result.buyback_budget)}{reservePct != null ? ` (${reservePct}%)` : ''} is set aside in case you buy back early
                      {result.estimated_fees > 0 ? ` and ${money(result.estimated_fees)} goes to fees` : ''}, so you keep {money(result.net_premium)}.
                      {!allEvents && result.earnings_date && planned.every(p => !optionFor(p).spans_earnings) ? ` ${planned.length > 1 ? 'Both calls expire' : 'It expires'} before ${result.ticker} reports on ${fmtDate(result.earnings_date)}.` : ''}
                    </p>
                  </section>
                )}

                {(lastPrices || result.warnings?.length > 0) && (
                  <ul aria-label="Heads-up" className="mt-6 flex flex-col gap-2.5">
                    {lastPrices && (
                      <HeadsUp text={liveAt
                        ? `Trading just opened and option prices are 15 minutes behind, so these are last-close prices until ${liveAt}. Scan again then to record a trade.`
                        : `Market closed, so these are last-close prices. Plan with them now and scan again${nextOpen ? ` after it opens (${nextOpen})` : ' when it opens'} to record a trade.`} />
                    )}
                    {result.warnings?.map((w, i) => <HeadsUp key={i} text={w} />)}
                  </ul>
                )}

                {planned.length > 0 && (
                  <div className="mt-7 rounded-card bg-surface p-5 md:p-6">
                    {saved ? (
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <span className="inline-flex items-center gap-2 text-17 font-semibold"><Check size={20} strokeWidth={2.4} className="text-accent" /> Saved</span>
                        <Link to="/positions" className="btn btn-secondary btn-sm">View in Positions <ArrowRight size={15} strokeWidth={2.2} /></Link>
                      </div>
                    ) : lastPrices ? (
                      <>
                        <h3 className="text-17 font-semibold">Record what you sold at</h3>
                        <p className="mt-1.5 text-15 text-fg-2">
                          Saving opens {liveAt ? `when prices catch up at ${liveAt}` : 'when the market opens'}, so trades are never recorded at an out-of-date price.
                        </p>
                      </>
                    ) : (
                      <>
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <h3 className="text-17 font-semibold">Record what you sold at <InfoTip text={TERMS.fill} /></h3>
                          <span className="text-13 text-muted">Per share, from your broker</span>
                        </div>
                        <div className={`mt-4 grid gap-3 ${planned.length + (showFees ? 1 : 0) >= 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
                          {planned.map((p, i) => (
                            <MoneyField key={i} id={`fill-${i}`} label={<><span className="md:hidden">{p.allocation_type}</span><span className="hidden md:inline">{p.allocation_type} · {strike(p.strike)}</span></>}
                              value={fills[i] ?? ''} onChange={v => update({ fills: fills.map((x, j) => (j === i ? v : x)) })}
                              error={fills[i] && !(fillValues[i] > 0) ? 'Enter the price' : null} />
                          ))}
                          {showFees && <MoneyField id="fill-fees" label="Fees" value={feesText} onChange={v => update({ fees: v })} />}
                        </div>
                        {fillsValid ? (
                          <p className="mt-3 text-13 text-fg-2">At these prices you collect {money(fillTotal)}{showFees ? ' after fees' : ''}.</p>
                        ) : (
                          <p className="mt-3 flex flex-wrap items-center gap-x-1.5 text-13 text-fg-2">
                            <span>Quoted {planned.map(p => `${planned.length > 1 ? `${p.allocation_type} ` : ''}${money(p.entry_price)}`).join(' · ')}.</span>
                            <button type="button" className="link text-13" onClick={fillQuotes}>Use {planned.length > 1 ? 'these' : 'it'}</button>
                            <span>if your broker filled at {planned.length > 1 ? 'those prices' : 'that price'}.</span>
                          </p>
                        )}
                        <button type="button" className="btn btn-primary btn-block mt-4 md:w-auto md:inline-flex" onClick={handleSave} disabled={saving || !fillsValid}>
                          {saving ? <><Spinner /> Saving…</> : 'Save trade'}
                        </button>
                        <p className="mt-3 text-12 text-muted">This records the trade in CovCall so you can track it. It doesn't place an order.</p>
                      </>
                    )}
                  </div>
                )}

                {planned.length === 0 && result.candidates.length > 0 && (
                  <p className="mt-8 flex items-start gap-2 text-15 text-fg-2">
                    <Check size={18} strokeWidth={2.4} className="mt-0.5 shrink-0 text-accent" />
                    All of your {result.ticker} contracts are already working, so there's nothing new to sell. Every option that matched is below.
                  </p>
                )}

                {result.candidates.length > 0 ? (
                  <section aria-labelledby="all-h" className="mt-12">
                    <div className="flex items-baseline justify-between gap-3">
                      <h2 id="all-h" className="text-20 font-semibold tracking-title">All {plural(result.candidates.length, 'matching call')}</h2>
                      <button type="button" className="link link-quiet min-h-11 text-13" aria-expanded={tableOpen} onClick={() => setTableOpen(o => !o)}>
                        {tableOpen ? 'Hide' : 'Show'}
                      </button>
                    </div>
                    {tableOpen && <div className="mt-2"><OptionsTable candidates={result.candidates} ticker={result.ticker} picked={picked} /></div>}
                  </section>
                ) : (
                  <EmptyState title="No options matched">
                    None of the {result.ticker} calls expiring in {result.min_dte}–{result.max_dte} days with a {Math.round(result.delta_min * 100)}–{Math.round(result.delta_max * 100)}% chance
                    of being called passed every filter. Try a wider range on the Strategy page, or lower the filters
                    {config.min_strike_pct > 0 ? ` (the distance above price is ${Math.round(config.min_strike_pct * 100)}%)` : ''}.
                  </EmptyState>
                )}
              </>
            )}
          </div>

          <aside className="mt-12 flex flex-col gap-10 md:mt-0">
            {rules.length > 0 && (
              <section aria-labelledby="rules-h">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 id="rules-h" className="text-17 font-semibold">Your rules</h2>
                  <Link to="/strategy" className="link link-quiet min-h-11 text-13">Change</Link>
                </div>
                <dl>
                  {rules.map(([k, v], i) => (
                    <div key={k} className={`flex justify-between gap-3 py-3 ${i < rules.length - 1 ? 'border-b border-line' : ''}`}>
                      <dt className="text-fg-2">{k}</dt><dd className="font-semibold">{v}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}
            <section aria-labelledby="filters-h">
              <div className="flex items-baseline justify-between gap-3">
                <h2 id="filters-h" className="text-17 font-semibold">Filters</h2>
                <span className="text-13 text-muted">{changed ? `${changed} changed` : 'Defaults'}</span>
              </div>
              <p className={`mt-2 text-13 ${filtersValid ? 'text-muted' : 'text-loss'}`}>{filterSummary}</p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button type="button" className="btn btn-secondary btn-sm" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(o => !o)}>
                  {filtersOpen ? 'Hide filters' : 'Adjust filters'}
                </button>
                {changed > 0 && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setForm(toForm(DEFAULT_CONFIG))}>
                    <RotateCcw size={14} strokeWidth={2} /> Reset
                  </button>
                )}
              </div>
              {filtersOpen && (
                <div className="mt-5 flex flex-col gap-4">
                  {FIELDS.map(f => (
                    <Field key={f.name} id={`f-${f.name}`} label={f.label} tip={<InfoTip text={f.tip} size={12} />}
                      prefix={f.prefix} suffix={f.pct ? '%' : undefined} type="text" inputMode={f.kind === 'int' ? 'numeric' : 'decimal'}
                      value={form[f.name]} onChange={e => updateField(f.name, cleanInput(e.target.value, f.kind))} error={fieldErrors[f.name]} />
                  ))}
                  {TOGGLES.map(t => (
                    <div key={t.name} className="flex min-h-11 items-center gap-2">
                      <label className="flex cursor-pointer items-center gap-3 text-15 text-fg-2">
                        <input type="checkbox" className="h-[18px] w-[18px] accent-[var(--accent)]" checked={form[t.name]} onChange={e => updateField(t.name, e.target.checked)} />
                        {t.label}
                      </label>
                      <InfoTip text={t.tip} size={12} />
                    </div>
                  ))}
                </div>
              )}
            </section>
          </aside>
        </div>
      )}
    </div>
  )
}
