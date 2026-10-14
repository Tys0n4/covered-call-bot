// src/lib/terms.js — plain-language explanations shown in the ⓘ tooltips

export const TERMS = {
  fillPrice:  'What you can expect per share when selling: the midpoint between the bid and the ask, where sell orders usually fill. Before commission.',
  yield:      'What you keep after commission, as a yearly return on your shares, so options with different lengths can be compared.',
  upside:     'How much the stock can rise before it reaches the strike and your shares may be sold.',
  delta:      'Delta, shown as a rough chance the stock ends above the strike and your shares get called away.',
  spread:     'Gap between the buy and sell quote. Smaller means a fairer, easier fill.',
  closingQuote: "The midpoint of this option's bid and ask at the last session's close. Good for planning; today's price can differ once trading moves.",
  lastTrade:  "No closing quote, so this is the last price the option traded at. It can be out of date if it hasn't traded for a while.",
  oldPrice:   "This option hasn't traded since before the latest session, so its price is from when the stock was elsewhere. The picks skip it.",
  minStrike:  'Optional: only show strikes at least this far above today’s price, e.g. 5% on a $100 stock means strikes of $105 or more. Leave at 0 to rely on your chance-of-being-called range (Strategy page).',
  minPremium: 'Ignore options paying less than this per share.',
  volume:     'Minimum contracts traded today. Higher means easier to trade.',
  openInt:    'Minimum open contracts. Higher means a more active, reliable market.',
  belowCost:  'The strike is under what you paid per share. If the shares are called away you sell them for less than you paid (the premium covers only part of that).',
  earnings:   'The company reports earnings before this option expires. The stock can jump on the news, which raises the chance your shares are called away.',
  buyToClose: 'What your broker calls buying back a call you sold. Pick "buy to close", not "buy to open", so the order ends your call instead of opening a new one.',
  fill:       "The price your broker actually sold each option for, from the order confirmation. If it matched the quote, \"Use these\" fills the quotes in.",
}
