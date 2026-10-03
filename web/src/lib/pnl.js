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
