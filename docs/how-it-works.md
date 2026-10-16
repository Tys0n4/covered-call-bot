# How CovCall works

The details behind the [README](../README.md): what each screen shows, how calls are picked and priced, when to buy back, how results are counted, and how to set up Discord alerts.

- [The screens](#the-screens)
- [Scanning](#scanning)
- [One trade per stock](#one-trade-per-stock)
- [Management](#management)
- [Alerts (Discord)](#alerts-discord)
- [Performance](#performance)
- [Accounts](#accounts)
- [Configuration](#configuration)
- [Design system](#design-system)

---

## The screens

**Home** — until your first call finishes, the one thing to do next leads ("Sell a call on your AAPL shares" → Find a call, which opens the finished scan), with a note that your broker has to approve you for options first. After that, what you've earned from calls this month is the big number, with a chart of it against the pace your monthly goal needs (Month, 3M or Year; hover or drag across it to see any day), and the next step sits beside it. Anything else that needs you is listed under the next step, then "Coming up": the next three events, earnings and Fed decisions first, with the rest of the month behind "See all". Once there are calls, premium in open calls, contracts working and yearly return, then one row per stock with a mark for each contract that has a call sold (Edit shares or cost is in its ⋯ menu). Adding a stock with at least 100 shares opens its scan straight away.

**Scanner** — pick a stock (each shows how many contracts it has to sell), scan, and get one answer: "Sell 3 calls, collect about $514" with the call (strike and expiry), then **the catch** in plain words (if the stock closes above the strike on that date your shares are sold at the strike, about how likely that is, and the tax on the gain if they are), any earnings or Fed decision before it expires, and the order to place at your broker (sell to open, contracts, the call, a limit price) with a Copy button. When a call with more room for the stock to rise is a real alternative, it's one tap away. Below that, "Sold it? Record what you got" takes the price your broker filled (any time, even with the market closed; "Use $1.71" fills in the quote while prices are live). Coming from Home's "Find a call", the scan starts by itself. Other heads-ups (prices from the last close, a strike below your cost) sit above the trade with the detail behind "More". Your rules and filters sit beside it, and every call that fit is listed below. The last scan of each stock stays on screen when you come back to it. **All stocks** scans every stock with contracts to sell at once (a few at a time, with the same rules and filters) and lists each one's trade, most premium first, with what selling them all would collect; picking one opens its full scan to record the fill. When several stocks have contracts to sell, Home's next step is "Scan all".

**Positions** — every open call across your stocks, with prices checked automatically (again every 5 minutes while the market is open, and shared with Home for a minute) and grouped into **Needs a decision**, **Ready to buy back** and **On track**. A call needs a decision only when its stock is within 2% of the strike or above it (or it's likely to be exercised early): the card says what happens in plain words and lays out the three choices (see Management). A call that's ready to buy back gets a card with premium kept against the target, the price now (and whether it's today's or the last close), your target price, what buying back costs, and the order to place at your broker (buy to close, how many contracts, the limit price) with a Copy button. Calls on track are one line each: how far the stock is under the strike, what you keep if it stays there (or the price that locks in your target), and how much is earned so far; each opens to the full card. "I rolled it" and "I bought it back" (or "Record what I did" on a call that needed a decision) record what you did at your broker; Edit and Delete are in the ⋯ menu, and changes can be undone. On phones, every pop-up is a sheet that slides up from the bottom.

**Record a roll** — the price you bought the old call back at and what the new one sold for, both per share as your broker shows them, with the net credit or debit worked out and your commission counted once for each trade.

**Performance** — what you kept after buybacks and fees, yearly return on capital, profit on shares sold at the strike, and a month-by-month chart against your goal.

**Strategy** — one question: "If your shares get sold at a profit, is that…" *Fine, I want more income* (calls with a 20–30% chance of being called) or *I'd rather keep my shares* (10–15%). Then an optional monthly goal. Everything else is under **Advanced**: the exact chance-of-being-called range, the expiry window and buy-back targets (each opens in place on bigger screens and in a sheet on phones), your broker's commission and Discord alerts. Changes wait for Save. Then Appearance (light or dark), CSV downloads of your data and your account.

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

- **The recommended call** — the lowest-delta option that reaches your monthly goal on its own. Your goal is spread across every contract your holdings can cover, so each contract has a monthly pace to hit. If no option in range reaches it, the best payer is picked and the Scanner says you're short. With no goal set, the best payer in range is picked.
- **The alternative** — the best monthly income near the safe end of your range (within 3 points of your lowest delta), for more room to rise. It's only offered when it's a different call.

Monthly income is what you expect to keep per contract: the premium × your buy-back target (the earlier event target when earnings or a Fed decision comes first), minus the commission to sell and the one to buy back, ÷ days to expiry × 30.4. The goal check uses the same number, so "on pace" means after buy-backs.

**Option prices** come from Cboe's delayed quotes, about 15 minutes behind. When Cboe fails or has nothing for a stock, the app uses Yahoo Finance instead; Yahoo isn't used at all while Cboe works. The Scanner and the price check say which source was used. After the close, Cboe's closing bid and ask are used (at their midpoint) and marked as a closing quote. Because the quotes are 15 minutes behind, the first 15 minutes after the open are treated the same way: the feed still shows the last session's closing quotes, so the Scanner says so (and only offers the quote as your fill once they catch up), and the buy-back alert check waits until then too.

**The stock price** comes from the same Cboe snapshot, so it always matches the option prices, with Alpha Vantage and then Yahoo as fallbacks. NYSE holidays and early closes are handled.

**Chance of being called (delta)** is Cboe's own delta when Cboe supplies one. Otherwise it's Black-Scholes delta, lowered slightly for dividend payers. Its volatility comes from Yahoo's implied volatility; outside market hours Yahoo reports roughly zero there, so it's worked out from each option's own price instead, or from the stock's recent moves as a last resort. The Scanner says when it's using these estimates. A quiet strike whose last trade is from before the latest session is marked **Old price**: the stock has moved since, so that price doesn't set its volatility and the picks skip it.

**Events.** When earnings, a Fed rate decision (FOMC dates in `backend/core/events.py`), or earnings from the industry's largest companies or your other stocks in the same industry fall before an option's expiry, it's flagged and both picks stay within 3 points of your lowest delta. Industry comes from Yahoo Finance; the leaders list is in `backend/core/events.py`. Earnings and ex-dividend dates come from Yahoo and are saved in the database, so when Yahoo doesn't answer (it rate-limits cloud servers, often right after a redeploy) the saved dates are used until they pass, and Yahoo is asked again after 5 minutes. If there's no saved date either, Home and the Scanner say the earnings date couldn't be checked instead of treating the stock as having none. The Fed publishes each year's dates the summer before, and they're listed through 2027; when an expiry runs past the last one, the Scanner says the calendar ends there.

---

## One trade per stock

Every contract your shares can cover that doesn't already have a call sold goes on the one recommended call: 300 shares with one call open leaves 2 contracts to sell. Nothing is set aside from the premium; the buy-back cost is counted when you actually buy back.

---

## Management

The management module prices each open call at what buying it back costs now: the midpoint between the bid and the ask, where buy orders usually fill, or the ask when there's no bid (a near-worthless call). It then calculates how much of the original premium you've kept. Each call gets one of three recommendations:

- **Buy back now** (shown under "Ready to buy back"): the call's price (the midpoint) is at or below your **buy-back price**. That's your target share of the premium kept (85% by default) turned into a price per share: what you sold for × (1 − target), rounded to the closest cent, since options trade in whole cents. Sold at $0.34: 85% kept is $0.051, so the buy-back price is $0.05 (85.3% kept). Sold at $0.38: $0.057 rounds to $0.06 (84.2% kept), which is closer than $0.05. Half a cent rounds down, and it's never below $0.01. If earnings or a Fed decision comes before the call expires, the earlier event target applies (65% by default). Both targets are set on the Strategy page; Positions and the Discord alerts show the price to set as a limit order.
- **Let it expire**: past the target, but it expires within a week with the stock at least 5% below the strike and no event before expiry. Buying back would mostly pay the spread and commission for very little risk removed.
- **Keep holding**: not at the target yet.
- **When a call needs a decision** (the stock is within 2% of the strike or above it, so your shares may be sold; a call costing a few cents more than you sold it for is normal and isn't one), the card shows three choices in plain words instead: **keep your shares** by buying the call back (what it costs now, and whether that leaves you up or down on the call), **let them be sold** at the strike (you keep the premium, and the share sale is shown on its own: what the shares sell for and the taxable gain, or loss, over your average cost, plus any rise above the strike that goes to the buyer), or **roll it later and higher**: later expiries (up to 45 days past the current one) at the same or a higher strike that pay a credit after both commissions, the soonest expiry for each strike, ranked by how much higher the strike goes. "See rolls" lists them, and picking one opens Record a roll with its expiry and strike filled in (Find a roll is also in every call's ⋯ menu). Home lists these calls too.
- **Early exercise before a dividend**: a call in the money whose time value (its price minus what it's worth exercised now) is less than the coming dividend is often exercised the trading day before the ex-dividend date. The card and Home say so, with the date to buy back or roll by. The dividend is estimated from the last one Yahoo reports.

Buyback costs include your usual commission. Discord alerts are sent for "Buy back now", calls likely to be exercised early, and calls with the stock above the strike (see below).

Outside market hours there's no ask, so a call is priced at its last trade, unless that trade is from before the latest session (a quiet strike that hasn't traded for days). Then Positions shows "Price unavailable" with the last trade date instead of a recommendation, until the market opens.

From the Positions page you can record a buyback (the price per share you paid, and fees), record a roll into a new call, or record that your shares were sold at the strike. When a call expires with the stock above the strike, the app asks you to confirm whether it was assigned instead of assuming.

---

## Alerts (Discord)

The app can post a message to a Discord channel when an open call needs you: it reached your buy-back target, it's likely to be exercised early for the dividend, or the stock went above its strike (early exercise is sent instead of "above the strike" when both apply). Each call is alerted once for each; the last two can be turned off on the Strategy page.

If the scheduled check stops running during market hours (none for 50 minutes after it was due), or Discord refuses a message (for example, the webhook was deleted), the Strategy page and Home say so. A Discord error stays until a message goes through, including a test message.

1. **Discord:** in the channel you want, open *Edit Channel → Integrations → Webhooks → New Webhook* and copy the webhook URL.
2. **App:** paste it under *Discord alerts* on the Strategy page and click Connect. A test message is sent right away.
3. **Railway:** add a variable `ALERTS_KEY` set to a long random string (for example the output of `python -c "import secrets; print(secrets.token_urlsafe(32))"`). It lets a scheduler run the check for every account with alerts on, without logging in, and can do nothing else.
4. **[cron-job.org](https://cron-job.org)** (free): create a cron job that sends `POST https://covered-call-bot-production.up.railway.app/alerts/cron` with the header `X-Alerts-Key: <your ALERTS_KEY>`. Schedule: time zone *America/New_York*, Monday–Friday, hours 9–15, minutes 15 and 45 (every 30 minutes, 9:45 a.m. to 3:45 p.m.; the 9:15 call is skipped because prices are still the last session's). It answers right away and checks in the background.

GitHub's free scheduled workflows turned out too unreliable for this (one run in a whole trading day), so `.github/workflows/alerts.yml` now only runs by hand: *Actions → Buy-back alerts → Run workflow* (needs the `ALERTS_KEY` repository secret). You can also run a check with `cd backend && python -m core.alerts`.

---

## Performance

A call's result is realized when it finishes. Net = premium − fees − buyback cost.

The page opens with the honest bottom line: what selling calls added **compared with just holding the shares**. That's the premium kept, minus any gain given up when shares were called away below their market price that day (the stock's close on the assignment date minus the strike). Bought-back calls already include any rise in the stock in their buyback cost, and expired calls capped nothing.

Assigned calls also record the profit or loss on the shares: (strike − your cost per share) × shares. Yearly return is net premium on the cost of the shares covered, weighted by how long each call was open. Bought-back calls with no cost entered are flagged and left out of the totals.

---

## Accounts

Everyone signs up with an email and a password, and each account has its own stocks, calls, strategy and Discord alerts; nobody else can see or change them. Passwords are stored as scrypt hashes. After 10 wrong passwords for an email within 15 minutes, logging in to it waits until the 15 minutes are up; devices already logged in keep working. New accounts are capped at 30 an hour so a script can't fill the free database.

A server from before accounts (one shared password, `APP_PASSWORD`) keeps its portfolio as unclaimed when it upgrades. The sign-up screen then asks for the old app password: whoever enters it takes that portfolio over, and anyone else starts with an empty one. With no `APP_PASSWORD` (local development), the first account takes it.

---

## Configuration

Defaults live in `backend/core/config.py`. Your delta range, expiry window, buy-back targets and monthly goal are edited on the Strategy page and override them:

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
    profit_capture_target_pct: float = 85.0
    event_buyback_pct: float = 65.0              # before earnings or a Fed decision
    commission_per_contract: float = 0.0         # your broker's, per option contract
```

Your broker's commission per contract is set on the Strategy page ($0 by default, and the fee boxes stay hidden at $0).

---

## Design system

Dark and light themes (Strategy › Appearance: System, Light or Dark), a top bar on desktop and five tabs on phones. One typeface (Geist, with aligned figures for money) on one type scale; one accent for money and actions, red only for losses and things that can't be undone, amber dots for earnings and Fed decisions. The colors, type sizes and radii are tokens in `web/src/index.css`, used through Tailwind (`bg-surface`, `text-muted`, `text-15` …).
