// src/components/StockChips.jsx — pick a stock: optionally "All stocks", then one chip per
// stock you hold. Scrolls sideways on phones when there are many.
export default function StockChips({ tickers, value, onChange, all = false, free = false, label = 'Stock' }) {
  return (
    <div role="group" aria-label={label}
      className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:flex-wrap md:gap-1.5 md:overflow-visible md:px-0">
      {all && (
        <button type="button" className="chip min-h-11 shrink-0 md:min-h-10" aria-pressed={value == null} onClick={() => onChange(null)}>
          All stocks
        </button>
      )}
      {tickers.map(t => (
        <button key={t.ticker} type="button" className="chip min-h-11 shrink-0 md:min-h-10" aria-pressed={value === t.ticker} onClick={() => onChange(t.ticker)}>
          {t.ticker}{free && t.available > 0 ? ` · ${t.available} free` : ''}
        </button>
      ))}
    </div>
  )
}
