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
}
