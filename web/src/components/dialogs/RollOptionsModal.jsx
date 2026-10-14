// src/components/dialogs/RollOptionsModal.jsx — later calls to roll an open call into, best
// first (backend core/rolls.py). "Use this roll" opens Record a roll with its expiry and
// strike filled in; the prices stay yours to enter from your broker.
import { useState } from 'react'
import Modal, { DialogHead } from './Modal'
import { Dot, Spinner } from '../ui'
import { useRolls } from '../../lib/useRolls'
import { useStrategy, chargesCommission } from '../../lib/useStrategy'
import { fmtDate, money, plural, signedMoney, strike } from '../../lib/format'

function note(r, p, deltaMax) {
  if (r.above_range && deltaMax) return `Above your ${Math.round(deltaMax * 100)}% chance-of-being-called limit`
  if (r.spans_earnings) return `Expires after ${p.ticker} earnings`
  if (r.spans_fed) return 'Expires after a Fed decision'
  return null
}

export default function RollOptionsModal({ position: p, onUse, onCancel }) {
  const strategy = useStrategy()
  const { data, loading, error } = useRolls(p.id)
  const [picked, setPicked] = useState(0)
  const rolls = data?.rolls || []
  const sel = rolls[picked]

  const row = (label, value, accent) => (
    <div className="flex justify-between gap-3 border-b border-line-2 py-2.5 last:border-b-0">
      <dt className="text-fg-2">{label}</dt><dd className={`font-semibold ${accent ? 'text-accent' : ''}`}>{value}</dd>
    </div>
  )

  return (
    <Modal onDismiss={onCancel} labelledBy="rolls-title" width={520}>
      <DialogHead id="rolls-title" title={`Roll the ${p.ticker} ${strike(p.strike)} call`} onClose={onCancel}
        sub={`${plural(p.contracts, 'contract')} · ${fmtDate(p.expiry)}.${data?.buyback_price ? ` Buy it back at about ${money(data.buyback_price)} a share and sell one of these on the same shares.` : ''}`} />

      {loading ? (
        <p className="mt-5 flex items-center gap-2 text-15 text-muted" role="status"><Spinner /> Looking for rolls…</p>
      ) : error ? (
        <p role="alert" className="mt-5 text-15 text-loss">{error}</p>
      ) : rolls.length === 0 ? (
        <p className="mt-5 text-15 text-fg-2">{data?.note || 'No roll pays a credit right now.'}</p>
      ) : (
        <>
          <div role="radiogroup" aria-label="Roll to" className="mt-5 flex flex-col gap-2">
            {rolls.map((r, i) => {
              const on = i === picked
              const why = note(r, p, strategy?.delta_max)
              return (
                <button key={`${r.expiry}|${r.strike}`} type="button" role="radio" aria-checked={on} onClick={() => setPicked(i)}
                  className={`w-full rounded-sm bg-panel px-3.5 py-3 text-left ${on ? 'ring-2 ring-accent' : 'ring-1 ring-edge'}`}>
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="text-15 font-semibold">{fmtDate(r.expiry)} · {strike(r.strike)} call</span>
                    <span className="text-15 font-semibold text-accent">{signedMoney(r.net_per_share)}</span>
                  </span>
                  <span className="mt-0.5 block text-13 text-muted">
                    Sells at {money(r.price)} · {r.strike > p.strike ? `strike up ${money(r.strike - p.strike)}` : 'same strike'}
                    {r.delta != null ? ` · ${Math.round(r.delta * 100)}% chance of being called` : ''}
                  </span>
                  {(why || (i === 0 && rolls.length > 1)) && (
                    <span className="mt-1 flex items-center gap-1.5 text-13 text-fg-2">
                      {why ? <><Dot tone="amber" />{why}</> : 'Most room to rise for a credit'}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          <dl className="mt-4 rounded-sm bg-panel px-4 py-1">
            {row(`Net credit, ${plural(p.contracts, 'contract')}`, signedMoney(sel.net_total), true)}
            {sel.strike_gain > 0 && row(`If called on ${fmtDate(sel.expiry)}`, `+${money(sel.strike_gain, 0)} vs. ${strike(p.strike)}`)}
          </dl>
          <p className="mt-3 text-12 text-muted">
            Only rolls that pay a credit{chargesCommission(strategy) ? ' after both commissions' : ''}, to a later expiry at the same or a higher strike.
            Midpoint prices{data.quotes_live ? ', about 15 minutes behind' : ' from the last close'}; you enter what your broker fills on the next step.
          </p>
        </>
      )}

      <div className="dialog-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn btn-primary" disabled={!sel} onClick={() => onUse(sel, data.buyback_price)}>Use this roll</button>
      </div>
    </Modal>
  )
}
