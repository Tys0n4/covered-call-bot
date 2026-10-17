// src/lib/monthProgress.js — Home's "<Month> so far": what finished calls earned this month
// (after buybacks and fees, from /performance) against the monthly goal's pace. Pace is
// where you'd be if the goal came in evenly through the month: goal × day ÷ days in month.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

// kept: earned this month; goal: monthly goal (0 or less = none set);
// month: "2026-10" (the API's month); today: "2026-10-08" (the market's date, see marketToday)
export function monthProgress({ kept, goal, month, today }) {
  const key = month || today.slice(0, 7)
  const [y, m] = key.split('-').map(Number)
  const days = new Date(y, m, 0).getDate()
  // Around midnight the API's month and today's date can disagree: count the month as just
  // started (or just ended) rather than mixing two months
  const day = today.slice(0, 7) === key ? Number(today.slice(8, 10)) : today < key ? 1 : days
  const base = {
    kept, day, days,
    daysLeft: days - day,
    monthFrac: day / days,
    monthName: MONTHS[m - 1],
  }
  if (!(goal > 0)) return { ...base, state: 'none' }

  const pace = (goal * day) / days
  const diff = kept - pace
  return {
    ...base,
    goal, pace, diff,
    pct: Math.max(0, Math.round((kept / goal) * 100)),
    goalFrac: Math.max(0, Math.min(kept / goal, 1)),
    over: kept - goal,
    state: kept >= goal ? 'reached' : diff >= 0 ? 'ahead' : 'behind',
  }
}
