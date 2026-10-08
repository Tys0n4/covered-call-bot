# How CovCall works

The details behind the [README](../README.md): what each screen shows, how calls are picked and priced, when to buy back, how results are counted, and how to set up Discord alerts.

- [The screens](#the-screens)
- [Scanning](#scanning)
- [Allocation](#allocation)
- [Management](#management)
- [Buy-back alerts (Discord)](#buy-back-alerts-discord)
- [Performance](#performance)
- [Configuration](#configuration)
- [Design system](#design-system)

---

## The screens

**Home** — what you've kept this month as the big number, with a chart of premium kept against the pace your monthly goal needs (Month, 3M or Year; hover or drag across it to see any day). Next to it, the one thing to do next and anything else that needs you, then "Coming up": the next three events, earnings and Fed decisions first, with the rest of the month behind "See all". Under the chart, premium in open calls, contracts working and yearly return, then one row per stock with a mark for each contract that has a call sold (Edit shares or cost is in its ⋯ menu).

**Scanner** — pick a stock (each shows how many contracts are free), scan, and get one recommended trade: what you collect as the big number, the income and balanced calls with each one's chance of being called, whether it keeps you on pace for your monthly goal, and boxes for the price you actually sold at (empty until you enter your broker's fills, or tap "Use these" if they matched the quotes). Heads-ups about earnings or a Fed decision sit under the trade, one line each with the detail behind "More". A plain line says whether premiums are rich or thin right now, with the numbers behind it in the ⓘ. Your rules and filters sit beside it, and every option that matched is listed below. The last scan of each stock stays on screen when you come back to it.

**Positions** — every open call across your stocks, with prices checked automatically and grouped into **Ready to buy back**, **Going against you** and **Holding**. Calls that need something from you get a card with premium kept against the target, the price now (and whether it's today's or the last close), your target price and what buying back costs. A call that's ready also shows the order to place at your broker (buy to close, how many contracts, the limit price) with a Copy button. Calls you're just holding are one line each and open to the full card. "I rolled it" and "I bought it back" record what you did at your broker; Edit and Delete are in the ⋯ menu, and changes can be undone. On phones, every pop-up is a sheet that slides up from the bottom.

**Record a roll** — the price you bought the old call back at and what the new one sold for, both per share as your broker shows them, with the net credit or debit worked out and your commission counted once for each trade.

**Performance** — what you kept after buybacks and fees, yearly return on capital, profit on shares sold when they're called away, and a month-by-month chart against your goal.

**Strategy** — your monthly goal, then the trading rules (chance of being called, expiry window, buy-back targets, split, reserve) as a list with each value on the right; a rule opens in place on bigger screens and in a sheet on phones, and changes wait for Save. Then Discord alerts, your broker's commission, Appearance (light or dark) and CSV downloads of your data.

---

## Scanning

The scanner fetches the options chain for a ticker within your expiry window (14–30 days by default). Each candidate is filtered by:

- Your delta range: the chance of being called, 20%–30% by default. This is the main risk rule.
- Minimum premium, volume, and open interest
- Optional minimum distance above the stock price (off by default; set it on the Scanner)
- Maximum bid-ask spread (35% of the mid price)

Each option is priced at the midpoint between the bid and the ask, where sell orders usually fill. Your broker's commission per contract (Strategy page, $0 by default) is subtracted, and yields are on what's left. Options that pay less than the commission are dropped.

Each scan also says whether premiums are **rich**, **normal** or **thin** right now: it compares the yearly move near-the-money options are priced for (implied volatility) with how much the stock actually moved over the last 20 trading days. Rich (implied at least 1.25× realized) is a good time to sell; thin (implied below realized) means you're paid less than the risk, and waiting may pay more.

From the options in your range the scanner picks two:

- **Balanced** — the best monthly income near the safe end of your range (within 3 points of your lowest delta).
- **Income** — the lowest-delta option that, blended with the balanced pick at your income/balanced split, reaches your monthly goal. Your goal is spread across every contract your holdings can cover, so each contract has a monthly pace to hit. If no option in range reaches it, the best payer is picked and the Scanner says you're short. With no goal set, the best payer in range is picked.

Monthly income is what you expect to keep per contract: the premium × your buy-back target (the earlier event target when earnings or a Fed decision comes first), minus the commission to sell and the one to buy back, ÷ days to expiry × 30.4. The goal check uses the same number, so "on pace" means after buy-backs.

**Option prices** come from Cboe's delayed quotes, about 15 minutes behind. When Cboe fails or has nothing for a stock, the app uses Yahoo Finance instead; Yahoo isn't used at all while Cboe works. The Scanner and the price check say which source was used. After the close, Cboe's closing bid and ask are used (at their midpoint) and marked as a closing quote. Because the quotes are 15 minutes behind, the first 15 minutes after the open are treated the same way: the feed still shows the last session's closing quotes, so the Scanner says so and keeps saving off until they catch up, and the buy-back alert check waits until then too.

**The stock price** comes from the same Cboe snapshot, so it always matches the option prices, with Alpha Vantage and then Yahoo as fallbacks. NYSE holidays and early closes are handled.

**Chance of being called (delta)** is Cboe's own delta when Cboe supplies one. Otherwise it's Black-Scholes delta, lowered slightly for dividend payers. Its volatility comes from Yahoo's implied volatility; outside market hours Yahoo reports roughly zero there, so it's worked out from each option's own price instead, or from the stock's recent moves as a last resort. The Scanner says when it's using these estimates. A quiet strike whose last trade is from before the latest session is marked **Old price**: the stock has moved since, so that price doesn't set its volatility and the picks skip it.

**Events.** When earnings, a Fed rate decision (FOMC dates in `backend/core/events.py`), or earnings from the industry's largest companies or your other stocks in the same industry fall before an option's expiry, it's flagged and both picks stay within 3 points of your lowest delta. Industry comes from Yahoo Finance; the leaders list is in `backend/core/events.py`. Earnings and ex-dividend dates come from Yahoo and are saved in the database, so when Yahoo doesn't answer (it rate-limits cloud servers, often right after a redeploy) the saved dates are used until they pass, and Yahoo is asked again after 5 minutes. If there's no saved date either, Home and the Scanner say the earnings date couldn't be checked instead of treating the stock as having none. Only confirmed Fed dates go there; when an expiry runs past the last one, the Scanner says the calendar ends there.

---

## Allocation

The planner maintains a **70/30 income/balanced split** across the total available contracts from your shares. It reads existing open positions and calculates how many contracts of each type are still needed to reach the target — so it always plans the right amount regardless of what's already open.

---

## Management

The management module prices each open call at what buying it back costs now: the midpoint between the bid and the ask, where buy orders usually fill, or the ask when there's no bid (a near-worthless call). It then calculates how much of the original premium you've kept. Each call gets one of three recommendations:

- **Buy back now** (shown under "Ready to buy back"): the call's price (the midpoint) is at or below your **buy-back price**. That's your target share of the premium kept (85% by default) turned into a price per share: what you sold for × (1 − target), rounded to the closest cent, since options trade in whole cents. Sold at $0.34: 85% kept is $0.051, so the buy-back price is $0.05 (85.3% kept). Sold at $0.38: $0.057 rounds to $0.06 (84.2% kept), which is closer than $0.05. Half a cent rounds down, and it's never below $0.01. If earnings or a Fed decision comes before the call expires, the earlier event target applies (65% by default). Both targets are set on the Strategy page; Positions and the Discord alerts show the price to set as a limit order.
- **Let it expire**: past the target, but it expires within a week with the stock at least 5% below the strike and no event before expiry. Buying back would mostly pay the spread and commission for very little risk removed.
- **Keep holding**: not at the target yet.
- **When a call goes against you** (it now costs more than you sold it for), the card shows your two real choices in dollars instead: buy back now (the loss on the call; you keep your shares) or let it be called away at the strike (premium plus the gain or loss on your shares over your average cost). It's marked "Stock above strike" in red when the stock has passed the strike (Home lists these too), or "Call is up" in amber while it's still below.

Buyback costs include your usual commission. Discord alerts are only sent for "Buy back now".

Outside market hours there's no ask, so a call is priced at its last trade, unless that trade is from before the latest session (a quiet strike that hasn't traded for days). Then Positions shows "Price unavailable" with the last trade date instead of a recommendation, until the market opens.

From the Positions page you can record a buyback (the price per share you paid, and fees), record a roll into a new call, or record that your shares were called away. When a call expires with the stock above the strike, the app asks you to confirm whether it was assigned instead of assuming.

---

## Buy-back alerts (Discord)

When an open call reaches your buy-back target, the app can post a message to a Discord channel. Each call is alerted once.

1. **Discord:** in the channel you want, open *Edit Channel → Integrations → Webhooks → New Webhook* and copy the webhook URL.
2. **App:** paste it under *Buy-back alerts* on the Strategy page and click Connect. A test message is sent right away.
3. **Railway:** add a variable `ALERTS_KEY` set to a long random string (for example the output of `python -c "import secrets; print(secrets.token_urlsafe(32))"`). It lets a scheduler run the check without your password, and can do nothing else.
4. **[cron-job.org](https://cron-job.org)** (free): create a cron job that sends `POST https://covered-call-bot-production.up.railway.app/alerts/cron` with the header `X-Alerts-Key: <your ALERTS_KEY>`. Schedule: time zone *America/New_York*, Monday–Friday, hours 9–15, minutes 15 and 45 (every 30 minutes, 9:45 a.m. to 3:45 p.m.; the 9:15 call is skipped because prices are still the last session's). It answers right away and checks in the background.

GitHub's free scheduled workflows turned out too unreliable for this (one run in a whole trading day), so `.github/workflows/alerts.yml` now only runs by hand: *Actions → Buy-back alerts → Run workflow* (needs the `APP_PASSWORD` repository secret). You can also run a check with `cd backend && python -m core.alerts`.

---

## Performance

A call's result is realized when it finishes. Net = premium − fees − buyback cost.

The page opens with the honest bottom line: what selling calls added **compared with just holding the shares**. That's the premium kept, minus any gain given up when shares were called away below their market price that day (the stock's close on the assignment date minus the strike). Bought-back calls already include any rise in the stock in their buyback cost, and expired calls capped nothing.

Assigned calls also record the profit or loss on the shares: (strike − your cost per share) × shares. Yearly return is net premium on the cost of the shares covered, weighted by how long each call was open. Bought-back calls with no cost entered are flagged and left out of the totals.

---

## Configuration

Defaults live in `backend/core/config.py`. Your delta range, expiry window, split, buy-back targets, reserve and monthly goal are edited on the Strategy page and override them:

```python
@dataclass(frozen=True)
class ScannerConfig:
    min_dte: int = 14
    max_dte: int = 30
    min_strike_pct_above_current: float = 0.0   # optional, off by default
    min_premium: float = 0.05
    min_volume: int = 10
    min_open_interest: int = 50
    delta_min: float = 0.20
    delta_max: float = 0.30
    income_weight: float = 0.70
    buyback_budget_pct: float = 0.15
    profit_capture_target_pct: float = 85.0
    event_buyback_pct: float = 65.0              # before earnings or a Fed decision
    commission_per_contract: float = 0.0         # your broker's, per option contract
```

Your broker's commission per contract is set on the Strategy page ($0 by default, and the fee boxes stay hidden at $0).

---

## Design system

Dark and light themes (Strategy › Appearance: System, Light or Dark), a top bar on desktop and five tabs on phones. One typeface (Geist, with aligned figures for money) on one type scale; one accent for money and actions, red only for losses and things that can't be undone, amber dots for earnings and Fed decisions. The colors, type sizes and radii are tokens in `web/src/index.css`, used through Tailwind (`bg-surface`, `text-muted`, `text-15` …).
