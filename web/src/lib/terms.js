// src/lib/terms.js — plain-language explanations shown in the ⓘ tooltips

export const TERMS = {
  strike:     'The price you agree to sell your shares at if the buyer uses the option.',
  expiry:     'The date the option ends. After this, you keep the premium and can sell a new one.',
  dte:        'Days left until the option expires.',
  premium:    'Cash you receive up front for selling the option. It is yours to keep.',
  yield:      'The premium as a yearly return on your shares, so options with different lengths can be compared.',
  upside:     'How much the stock can rise before it reaches the strike and your shares may be sold.',
  delta:      'Delta, shown as a rough chance the stock ends above the strike and your shares get called away.',
  spread:     'Gap between the buy and sell quote. Smaller means a fairer, easier fill.',
  quote:      'LIVE means the price is current. Outside market hours quotes go stale.',
  income:     'Income trades aim for the highest premium, with strikes closer to today’s price.',
  balanced:   'Balanced trades leave more room for the stock to rise, for a smaller premium.',
  available:  'Contracts you can still sell. Each contract covers 100 shares.',
  buyback:    'Money set aside to buy the option back early if it becomes cheap.',
  profit:     'How much of the original premium you have kept so far. Buying back near the target locks in the gain.',
  minStrike:  'Only show strikes at least this far above today’s price (0.20 = 20%).',
  minPremium: 'Ignore options paying less than this per share.',
  volume:     'Minimum contracts traded today. Higher means easier to trade.',
  openInt:    'Minimum open contracts. Higher means a more active, reliable market.',
  belowCost:  'The strike is under what you paid per share. If the shares are called away you sell them for less than you paid (the premium covers only part of that).',
  targetDelta:'The balanced pick aims for this delta (0.22 ≈ 22% chance of being called away).',
}
