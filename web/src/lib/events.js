// src/lib/events.js — what comes before an option expires, in words:
// "after AMZN earnings and the Fed decision" (null when nothing does)
export function eventsText(o, ticker) {
  const parts = []
  if (o.spans_earnings) parts.push(`${ticker ? `${ticker} ` : ''}earnings`)
  if (o.spans_fed) parts.push('the Fed decision')
  if (o.spans_industry) parts.push('industry earnings')
  if (o.spans_ex_dividend) parts.push('the ex-dividend date')
  if (!parts.length) return null
  return `after ${parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0]}`
}
