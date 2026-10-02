// src/lib/format.js — small display helpers shared by the pages

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// "2026-10-23" -> "Oct 23" (adds the year only when it isn't this year)
export function fmtDate(iso) {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return iso
  const label = `${MONTHS[m - 1]} ${d}`
  return y === new Date().getFullYear() ? label : `${label}, ${y}`
}

// Whole days from today until an ISO date
export function daysUntil(iso) {
  if (!iso) return null
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  const target = new Date(y, m - 1, d)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  return Math.round((target - today) / 86400000)
}

export const money = (n, digits = 2) =>
  n == null || Number.isNaN(n) ? '—' : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`

export const pct = (n, digits = 1) => (n == null || Number.isNaN(n) ? '—' : `${Number(n).toFixed(digits)}%`)

export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
