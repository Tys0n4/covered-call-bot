// src/lib/strategy.js — strategy defaults (the API stores the real values)

// Split one stock's contracts into [income, balanced]. Same rule as the API
// (app/strategy.py): round to nearest, and an exact half goes to Income.
export function splitContracts(total, incomeWeight) {
  const t = Math.max(Math.floor(total) || 0, 0)
  const income = Math.min(Math.max(Math.floor(t * incomeWeight + 0.5 + 1e-9), 0), t)
  return [income, t - income]
}

export const DEFAULT_STRATEGY = {
  income_weight: 0.70,             // share of contracts sold as Income picks
  profit_capture_target_pct: 85,   // "Buy back now" once this much premium is kept
  event_buyback_pct: 65,           // ...or this much when earnings / a Fed meeting comes before expiry
  buyback_budget_pct: 0.15,        // part of each premium set aside for buybacks
  monthly_goal: 0,                 // premium goal per month in dollars (0 = off)
  delta_min: 0.20,                 // sell calls with a 20-30% chance of being called
  delta_max: 0.30,
  min_dte: 14,                     // expiring in 14-30 days
  max_dte: 30,
  commission_per_contract: 0,      // your broker's commission per option contract
}

// Options trade in whole cents, so a buy-back target becomes a price: the
// closest cent to (1 − target) × what you sold for. Half a cent rounds down
// (you keep more), and it's never below $0.01. Same rule as the backend.
export function buybackPrice(entry, targetPct) {
  if (!(entry > 0)) return 0
  const cents = Math.round(entry * (100 - targetPct) * 1000) / 1000
  return Math.max(Math.ceil(cents - 0.5), 1) / 100
}
