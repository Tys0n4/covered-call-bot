// src/pages/Scanner.jsx — find a covered call to sell on one of your stocks
import { useState, useEffect, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Check, RefreshCw, RotateCcw, ScanLine } from 'lucide-react'
import { runScan, runScanAll, savePositions, saveStrategy, apiError } from '../api/client'
import { useStrategy, chargesCommission, forgetStrategy } from '../lib/useStrategy'
import { useTicker } from '../context/TickerContext'
import { usePageTitle } from '../components/PageHeader'
import InfoTip from '../components/InfoTip'
import ServerDown from '../components/ServerDown'
import EmptyState, { AddStockLink } from '../components/EmptyState'
import CallsList from '../components/CallsList'
import ScanAll from '../components/ScanAll'
import RecommendedTrade from '../components/RecommendedTrade'
import StockChips from '../components/StockChips'
import { Dot, Field, Spinner } from '../components/ui'
import { TERMS } from '../lib/terms'
import { fmtDate, money, plural } from '../lib/format'
import { moneyValue } from '../lib/pnl'

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
const lastScans = new Map()   // ticker -> { result, fill, fees, saved, at, useAlt }
// ...and so does the last scan of every stock ("All stocks"), and whether that was showing
const lastAll = { on: false, scan: null }   // scan: { data, at }
const clock = iso => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
const wide = () => window.matchMedia?.('(min-width: 768px)').matches

export default function Scanner() {
  usePageTitle('Scanner')
  const { selected, tickers, selectTicker, loaded, loadError, refresh } = useTicker()
  const [params, setParams] = useSearchParams()
  // "All stocks" (/scanner?all=1) or one stock. Home's "Scan all" adds go=1: scan right away,
  // unless every stock was already scanned
  const [all, setAllState] = useState(() => params.get('all') === '1' || lastAll.on)
  const setAll = on => { lastAll.on = on; setAllState(on) }
  const [allScan, setAllScan] = useState(() => lastAll.scan)
  const [autoScan] = useState(() => params.get('go') === '1' && all && !lastAll.scan)
  // Home's "Find a call" (/scanner?go=1): scan the selected stock right away
  const [autoOne] = useState(() => params.get('go') === '1' && !all && !!selected)
  const [allLoading, setAllLoading] = useState(autoScan)
  const [form, setForm]       = useState(() => toForm(loadConfig()))   // boxes, exactly as typed
  const [scan, setScan]       = useState(() => (autoOne ? null : lastScans.get(selected) || null))
  const [loading, setLoading] = useState(autoOne)
  const [error, setError]     = useState(null)
  const [saving, setSaving]   = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [tableOpen, setTableOpen] = useState(wide)
  const strategy = useStrategy()          // delta range, expiry window, commission and tax account
  const showFees = chargesCommission(strategy)
  // Taxable or retirement account, for the tax line; changed right on the trade and saved to the strategy
  const [taxChoice, setTaxChoice] = useState(null)
  const taxAccount = taxChoice ?? strategy?.tax_account ?? 'taxable'
  const changeTaxAccount = account => {
    setTaxChoice(account)
    if (!strategy) return
    saveStrategy({ ...strategy, tax_account: account })
      .then(r => forgetStrategy(r.data))
      .catch(e => { setTaxChoice(null); setError(apiError(e, "Couldn't save the account type.")) })
  }

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
  const saved = !!scan?.saved

  const updateField = (k, text) => setForm(f => ({ ...f, [k]: text }))

  // A fresh scan: the price you sold at stays empty until you enter your broker's fill, so a guess is
  // never saved as a trade; the fee box starts at your usual commission
  const freshScan = (data, at) => ({
    result: data, fill: '', fees: data.estimated_fees > 0 ? data.estimated_fees.toFixed(2) : '',
    saved: false, at, useAlt: false,
  })

  const scanOne = ticker => runScan({ ...config, ticker })
    .then(res => {
      const next = freshScan(res.data, new Date().toISOString())
      lastScans.set(res.data.ticker, next)
      setScan(next)
    })
    .catch(e => setError(apiError(e, 'Scan failed. Is the API running?')))
    .finally(() => setLoading(false))
  const handleScan = () => {
    if (!selected || !filtersValid) return
    setLoading(true); setError(null)
    scanOne(selected)
  }
  // Arriving from Home's "Find a call": scan now (once), and drop go=1 so a reload doesn't scan again
  const oneStarted = useRef(false)
  useEffect(() => {
    if (!autoOne || oneStarted.current) return
    oneStarted.current = true
    scanOne(selected)
    setParams({}, { replace: true })
  }, [autoOne]) // eslint-disable-line react-hooks/exhaustive-deps

  const scanAll = () => runScanAll(config)
    .then(res => {
      const next = { data: res.data, at: new Date().toISOString() }
      lastAll.scan = next
      setAllScan(next)
    })
    .catch(e => setError(apiError(e, 'Scan failed. Is the API running?')))
    .finally(() => setAllLoading(false))
  const handleScanAll = () => {
    if (!filtersValid) return
    setAllLoading(true); setError(null)
    scanAll()
  }
  // Arriving from Home's "Scan all": start now (once), and drop go=1 so a reload doesn't scan again
  const autoStarted = useRef(false)
  useEffect(() => {
    if (!autoScan || autoStarted.current) return
    autoStarted.current = true
    scanAll()
    setParams({ all: '1' }, { replace: true })
  }, [autoScan]) // eslint-disable-line react-hooks/exhaustive-deps

  // From "All stocks" to one stock's full scan, already loaded (unless you've scanned it since)
  const review = item => {
    const r = item.result
    const existing = lastScans.get(item.ticker)
    if (r && !(existing && existing.at >= allScan.at)) lastScans.set(item.ticker, freshScan(r, allScan.at))
    setAll(false); setError(null)
    setScan(lastScans.get(item.ticker) || null); setScannedFor(item.ticker)
    selectTicker(item.ticker)
  }

  const handleSave = async () => {
    const r = scan?.result
    const trade = r && (scan.useAlt && r.alternative ? r.alternative : r.planned_positions[0])
    const price = moneyValue(scan?.fill ?? '')
    if (!trade || !(price > 0)) return
    setSaving(true)
    try {
      // With the call the Scanner recommended, so Performance can show whether following it helped
      const pick = r.planned_positions[0]
      await savePositions([{
        ticker: r.ticker, expiry: trade.expiry, strike: trade.strike, contracts: trade.contracts,
        entry_price: price, allocation_type: trade.allocation_type, fees: moneyValue(scan.fees) || 0,
        recommended_expiry: pick.expiry, recommended_strike: pick.strike,
      }])
      update({ saved: true })
      refresh().catch(() => {})
    } catch (e) {
      setError(apiError(e, 'Could not save the trade. Is the API running?'))
    } finally {
      setSaving(false)
    }
  }

  const holding = tickers.find(t => t.ticker === selected)
  const planned = result?.planned_positions || []
  // Market closed (or opened under 15 min ago, while the delayed quotes catch up): results use
  // last-session prices. You can still record what your broker filled; only "use the quote" waits.
  const lastPrices = result?.quotes_live === false
  const liveAt = lastPrices && result?.quotes_live_at ? clock(result.quotes_live_at) : null
  const nextOpen = result?.next_market_open
    ? new Date(result.next_market_open).toLocaleString('en-US', { weekday: 'long', hour: 'numeric', minute: '2-digit' })
    : null
  const shownTrade = result && (scan.useAlt && result.alternative ? result.alternative : planned[0])
  const picked = new Map(shownTrade ? [[`${shownTrade.expiry}|${shownTrade.strike}`, 'Picked']] : [])

  const rules = strategy
    ? [
        ['Chance of being called', `${Math.round(strategy.delta_min * 100)}–${Math.round(strategy.delta_max * 100)}%`],
        ['Expiring in', `${strategy.min_dte}–${strategy.max_dte} days`],
      ]
    : []
  const changed = FIELDS.filter(f => config[f.name] !== DEFAULT_CONFIG[f.name]).length + TOGGLES.filter(t => config[t.name]).length
  const filterSummary = !filtersValid
    ? 'One of the filters needs fixing before you can scan.'
    : `At least ${money(config.min_premium)} a share, ${config.min_volume.toLocaleString()} contracts traded today and ${config.min_open_interest.toLocaleString()} open.`
      + (config.min_strike_pct > 0 ? ` Strikes at least ${Math.round(config.min_strike_pct * 100)}% above the price.` : '')
      + (config.exclude_below_cost ? ' Strikes below your cost are skipped.' : '')
      + (config.avoid_earnings ? ' Expiries after earnings are skipped.' : '')

  const freeStocks = tickers.filter(t => t.available > 0)
  const freeTotal = freeStocks.reduce((s, t) => s + t.available, 0)
  const allColumn = (
    <div className="min-w-0">
      {error && <p role="alert" className="mb-5 flex items-start gap-2 text-15 text-loss"><Dot tone="loss" className="mt-2" />{error}</p>}
      {allLoading ? (
        <div className="flex items-center gap-4 rounded-card bg-surface p-6" role="status">
          <Spinner className="h-6 w-6 text-accent" />
          <div><div className="text-17 font-semibold">Checking {plural(freeStocks.length, 'stock')}…</div><div className="text-13 text-muted">Up to four at a time. This usually takes 5–20 seconds.</div></div>
        </div>
      ) : allScan ? (
        <ScanAll data={allScan.data} tickers={tickers} onReview={review} />
      ) : (
        <section aria-labelledby="all-ready-h">
          <h2 id="all-ready-h" className="text-22 font-semibold tracking-title">Find calls for every stock at once</h2>
          <p className="mt-2 max-w-[560px] text-15 text-fg-2">
            {freeStocks.length
              ? `Scans ${freeStocks.map(t => t.ticker).join(', ')} with your rules and filters and lists the recommended trade for each, with what selling them all would collect.`
              : 'Every contract already has a call sold, so there is nothing to scan.'}
          </p>
          {freeStocks.length > 0 && (
            <div className="mt-6">
              <button type="button" className="btn btn-primary" onClick={handleScanAll} disabled={!filtersValid}>
                <ScanLine size={17} strokeWidth={2} /> Scan {plural(freeStocks.length, 'stock')}
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  )

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
            <StockChips label="Stock to scan" free tickers={tickers} value={all ? null : selected}
              all={tickers.length > 1} allLabel={`All stocks${freeTotal ? ` · ${freeTotal} to sell` : ''}`}
              onChange={t => { if (t == null) setAll(true); else { setAll(false); selectTicker(t) } }} />
          </div>
        )}
        {all && allScan && !allLoading && (
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-13 text-muted md:inline">Scanned {clock(allScan.at)}</span>
            <button type="button" className="icon-btn -mr-2 md:hidden" onClick={handleScanAll} aria-label="Scan every stock again">
              <RefreshCw size={19} strokeWidth={1.9} />
            </button>
            <button type="button" className="btn btn-secondary btn-sm hidden md:inline-flex" onClick={handleScanAll} disabled={!filtersValid}>
              <RefreshCw size={15} strokeWidth={2} /> Scan again
            </button>
          </div>
        )}
        {!all && result && !loading && (
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
          {all ? allColumn : <div className="min-w-0">
            <p className="flex flex-wrap gap-x-5 gap-y-1 text-15 text-fg-2">
              {result && <span>{result.ticker} <strong className="font-semibold text-fg">{money(result.current_price)}</strong>{lastPrices ? ' at the last close' : ''}</span>}
              {holding && <span>{holding.shares.toLocaleString()} shares{holding.available > 0 && holding.open_total > 0 ? ` · ${(holding.available * 100).toLocaleString()} not covered` : ''}{holding.avg_cost > 0 ? ` · bought at ${money(holding.avg_cost)}` : ''}</span>}
              {result?.earnings_date && <span>Earnings {fmtDate(result.earnings_date)}</span>}
              {result?.ex_dividend_date && <span>Ex-dividend {fmtDate(result.ex_dividend_date)}</span>}
            </p>

            {error && <p role="alert" className="mt-5 flex items-start gap-2 text-15 text-loss"><Dot tone="loss" className="mt-2" />{error}</p>}

            {loading && (
              <div className="mt-10 flex items-center gap-4 rounded-card bg-surface p-6" role="status">
                <Spinner className="h-6 w-6 text-accent" />
                <div><div className="text-17 font-semibold">Checking {selected} options…</div><div className="text-13 text-muted">This usually takes 5–10 seconds.</div></div>
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
                  {[['Scan', 'Calls on your shares that match your rules and filters.'], ['Pick', 'One call for all your free contracts, and the order to place at your broker.'], ['Track', 'Save it, then follow it on Positions until you close it.']].map(([t, d], i) => (
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
                {(liveAt || result.warnings?.length > 0) && (
                  <ul aria-label="Heads-up" className="mt-5 flex flex-col gap-2.5">
                    {liveAt && <HeadsUp text={`Trading just opened and option prices are 15 minutes behind, so these are last-close prices until ${liveAt}. Scan again then for current ones.`} />}
                    {result.warnings?.map((w, i) => <HeadsUp key={i} text={w} />)}
                  </ul>
                )}

                {planned.length > 0 && (
                  <RecommendedTrade result={result} useAlt={scan.useAlt} onToggleAlt={() => update({ useAlt: !scan.useAlt, fill: '' })}
                    fill={scan.fill} fees={scan.fees} showFees={showFees} saved={saved} saving={saving}
                    onFill={v => update({ fill: v })} onFees={v => update({ fees: v })} onSave={handleSave}
                    lastPrices={lastPrices} nextOpen={nextOpen} taxAccount={taxAccount} onTaxAccount={changeTaxAccount} />
                )}

                {planned.length === 0 && result.candidates.length > 0 && (
                  <p className="mt-8 flex items-start gap-2 text-15 text-fg-2">
                    <Check size={18} strokeWidth={2.4} className="mt-0.5 shrink-0 text-accent" />
                    All of your {result.ticker} contracts are already working, so there's nothing new to sell. Every option that matched is below.
                  </p>
                )}

                {result.candidates.length > 0 ? (
                  <section aria-labelledby="all-h" className="mt-10">
                    <div className="flex items-baseline justify-between gap-3">
                      <h2 id="all-h" className="text-17 font-semibold">All {plural(result.candidates.length, 'call')} that fit</h2>
                      <button type="button" className="link link-quiet min-h-11 text-13" aria-expanded={tableOpen} onClick={() => setTableOpen(o => !o)}>
                        {tableOpen ? 'Hide' : 'Show'}
                      </button>
                    </div>
                    {tableOpen && (
                      <div className="mt-2">
                        <CallsList candidates={result.candidates} ticker={result.ticker} price={result.current_price} picked={picked}
                          contracts={planned[0]?.contracts || result.allocation_summary?.available || result.allocation_summary?.total_contracts || 1} />
                      </div>
                    )}
                  </section>
                ) : (
                  <EmptyState title="No options matched">
                    None of the {result.ticker} calls expiring in {result.min_dte}–{result.max_dte} days with a {Math.round(result.delta_min * 100)}–{Math.round(result.delta_max * 100)}% chance
                    of being called passed every filter. Try a wider range on the Strategy page, or lower the filters
                    {config.min_strike_pct > 0 ? ` (the distance above price is ${Math.round(config.min_strike_pct * 100)}%)` : ''}.
                  </EmptyState>
                )}

                <p className="mt-8 text-12 text-muted">
                  Not investment advice. CovCall shows the call that fits the rules you set, and what could happen. It doesn't know your whole
                  situation; the decision and the trade are yours.
                </p>
              </>
            )}
          </div>}

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
