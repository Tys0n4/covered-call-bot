// src/lib/pnl.js — what a covered call actually made, after buybacks and fees

const n = v => Number(v) || 0

// Option profit in dollars: premium − fees − buyback cost. null when it was
// bought back but the cost wasn't entered (so the result isn't known).
export function optionNet(p) {
  if (p.status === 'CLOSED' && p.close_cost == null) return null
  return n(p.premium_total) - n(p.open_fees) - n(p.close_cost) - n(p.close_fees)
}

export const totalFees = p => n(p.open_fees) + n(p.close_fees)

// "Bought back", "Rolled", "Expired", "Assigned" (rolledIds: ids that were rolled into a new call)
export function resultLabel(p, rolledIds) {
  if (p.status === 'EXPIRED') return 'Expired'
  if (p.status === 'ASSIGNED') return 'Assigned'
  if (p.status === 'CLOSED') return rolledIds?.has(p.id) ? 'Rolled' : 'Bought back'
  return 'Open'
}

// Share of the premium kept, as shown: rounded down, so a call at 64.6% never
// reads as having reached a 65% target
export const keptPct = v => Math.floor((Number(v) || 0) + 1e-9)

// Split a total fee across trades by contract count, to the cent
export function splitFees(total, contracts) {
  const cents = Math.round(n(total) * 100)
  const sum = contracts.reduce((s, c) => s + c, 0) || 1
  const parts = contracts.map(c => Math.floor((cents * c) / sum))
  parts[parts.length - 1] += cents - parts.reduce((s, c) => s + c, 0)
  return parts.map(c => c / 100)
}

// "12.5" style money input: digits and one dot, two decimals at most
export function cleanMoney(raw) {
  let t = raw.replace(/[^0-9.]/g, '')
  const dot = t.indexOf('.')
  if (dot !== -1) t = t.slice(0, dot + 1) + t.slice(dot + 1).replace(/\./g, '').slice(0, 2)
  return t.replace(/^0+(?=\d)/, '')
}

// '' or '.' -> null, otherwise the number
export const moneyValue = t => (t === '' || t === '.' ? null : Number(t))

// A per-share option price as dollars for the whole trade (100 shares a contract), to the cent
export const contractsTotal = (price, contracts) => Math.round(price * contracts * 100 * 100) / 100

// Your usual commission for this many contracts, as the text a fee box starts with ('' when there's none)
export function usualFees(strategy, contracts) {
  const fee = (strategy?.commission_per_contract || 0) * (contracts || 0)
  return fee > 0 ? fee.toFixed(2) : ''
}

// A call that's gone against you: it now costs more to buy back than you sold
// it for. Returns null otherwise (or without a current price for the call and
// the stock). The two real choices, in dollars:
//   buybackPL - buy it back now (premium kept minus the cost to close)
//   calledPL  - let it be called away at the strike: premium kept plus the gain
//               (or loss) on the shares over your cost; null if the cost is unknown
export function againstYou(p, evaluation, avgCost) {
  const now = evaluation?.current_option_price
  const stock = evaluation?.stock_price
  if (!(now > 0) || !(stock > 0) || !(now > p.entry_price)) return null
  const shares = p.contracts * 100
  const collected = p.premium_total - n(p.open_fees)
  const cost = p.cost_basis ?? avgCost ?? null
  return {
    aboveStrike: stock > p.strike,
    stock, now, shares, collected,
    fromStrikePct: Math.abs(stock / p.strike - 1) * 100,
    buybackCost: evaluation.cost_to_close,
    buybackPL: collected - evaluation.cost_to_close,
    shareGain: cost > 0 ? (p.strike - cost) * shares : null,
    calledPL: cost > 0 ? collected + (p.strike - cost) * shares : null,
    cost,
    upsideGiven: stock > p.strike ? (stock - p.strike) * shares : 0,
  }
}
