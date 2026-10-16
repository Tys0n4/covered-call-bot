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

// The stock this close under the strike (or above it) puts your shares at risk of being sold
export const DECISION_PCT = 2

// A call that needs a decision: the stock is within 2% of the strike or above it, so your
// shares may be sold. A call costing a few cents more than you sold it for is normal and
// isn't one. Returns null otherwise (or without a stock price). The choices, in dollars:
//   buybackPL - buy it back now and keep your shares (premium kept minus the cost to close;
//               null without a current price for the call)
//   shareGain - let the shares be sold at the strike: the gain (or loss) on them over your
//               cost, which is taxable; null if the cost is unknown. The premium is yours either way.
export function needsDecision(p, evaluation, avgCost) {
  const stock = evaluation?.stock_price
  if (!(stock > 0) || stock < p.strike * (1 - DECISION_PCT / 100)) return null
  const now = evaluation.current_option_price > 0 ? evaluation.current_option_price : null
  const shares = p.contracts * 100
  const collected = p.premium_total - n(p.open_fees)
  const cost = p.cost_basis ?? avgCost ?? null
  const buybackCost = now != null ? evaluation.cost_to_close : null
  return {
    aboveStrike: stock > p.strike,
    stock, now, shares, collected, cost,
    fromStrikePct: Math.abs(stock / p.strike - 1) * 100,
    buybackCost,
    buybackPL: buybackCost != null ? collected - buybackCost : null,
    saleTotal: p.strike * shares,
    shareGain: cost > 0 ? (p.strike - cost) * shares : null,
    upsideGiven: stock > p.strike ? (stock - p.strike) * shares : 0,
  }
}
