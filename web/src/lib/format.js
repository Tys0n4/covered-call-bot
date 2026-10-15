// src/lib/format.js — small display helpers shared by the pages

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Today in New York, "2026-10-14": the market's calendar, which expiries and the API use.
// (In Alberta it's still yesterday for two hours after New York's midnight.)
const NEW_YORK_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
export const marketToday = (now = new Date()) => NEW_YORK_DATE.format(now)

const utcDay = iso => { const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return Date.UTC(y, m - 1, d) }

// "2026-10-23" -> "Oct 23" (adds the year only when it isn't this year)
export function fmtDate(iso) {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return iso
  const label = `${MONTHS[m - 1]} ${d}`
  return y === Number(marketToday().slice(0, 4)) ? label : `${label}, ${y}`
}

// Whole days from today (New York's date, like the API) until an ISO date
export function daysUntil(iso) {
  if (!iso) return null
  return Math.round((utcDay(iso) - utcDay(marketToday())) / 86400000)
}

export const money = (n, digits = 2) =>
  n == null || Number.isNaN(n) ? '—' : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`

// A strike as people say it: "$245", "$112.50"
export const strike = n => (n == null ? '—' : Number.isInteger(Number(n)) ? `$${Number(n).toLocaleString('en-US')}` : money(n))

// Signed money: "+$613.05", "−$40.00"
export const signedMoney = (n, digits = 2) => (n == null ? '—' : `${n < 0 ? '−' : '+'}${money(Math.abs(n), digits)}`)

export const pct = (n, digits = 1) => (n == null || Number.isNaN(n) ? '—' : `${Number(n).toFixed(digits)}%`)

export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
