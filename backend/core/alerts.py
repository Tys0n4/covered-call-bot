# alerts.py
"""
Alerts to Discord.

You paste a Discord webhook URL on the Strategy page (Discord: channel
settings → Integrations → Webhooks → New Webhook → Copy URL). A scheduled job
runs `check_and_alert()` during market hours and posts one message to that
channel listing every open call that newly:

  - may be exercised early for the dividend (buyback.early_exercise_risk)
  - has the stock above its strike
  - reached your "buy back" target

Each call is alerted once for each (positions.*_alerted_at); the first two
can be turned off. When the scheduled check stops running, or Discord refuses
a message, GET /alerts says so (check_overdue, last_error), and so does the app.

Run a check by hand (e.g. from a cron job):  cd backend && python -m core.alerts
"""
from __future__ import annotations

import logging
import os
import re
from datetime import datetime, timedelta, timezone

import requests
from sqlalchemy import insert, select, update

from core import market_hours
from core.buyback import evaluate_positions
from core.db import UNCLAIMED, alert_settings, get_engine, positions
from core.market_hours import NEW_YORK, OPEN, QUOTE_DELAY, delayed_quotes_live
from core.positions import load_open_positions
from core.strategy import effective_config

log = logging.getLogger(__name__)

# Only real Discord webhooks: the server posts to this URL, so don't let it be anything else
WEBHOOK_RE = re.compile(r"^https://(?:(?:canary|ptb)\.)?discord(?:app)?\.com/api/webhooks/\d+/[\w-]+$")

# Where "Open Positions" in the message points
APP_URL = os.environ.get("APP_URL", "https://covered-call-bot.vercel.app").rstrip("/")

GREEN = 0x34EDB3
AMBER = 0xF2B13E
RED = 0xFF6A3D

# The scheduler runs every 30 minutes; a check this late means it has stopped
OVERDUE_AFTER = timedelta(minutes=50)


class AlertError(Exception):
    """A problem the user can fix (bad URL, Discord refused the message)."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def valid_webhook(url: str) -> bool:
    return bool(WEBHOOK_RE.match(url or ""))


# --- Settings ------------------------------------------------------------------

def load_alert_settings(user_id: int) -> dict:
    """The account's alert settings (one row per account, id = users.id)."""
    with get_engine().connect() as conn:
        row = conn.execute(select(alert_settings).where(alert_settings.c.id == user_id)).mappings().first()
    if row is None:
        return {"discord_webhook": None, "enabled": False, "last_check_at": None, "last_error": None,
                "notify_early": True, "notify_strike": True}
    return {
        "discord_webhook": row["discord_webhook"], "enabled": bool(row["enabled"]),
        "last_check_at": row["last_check_at"], "last_error": row["last_error"],
        "notify_early": row["notify_early"] != 0, "notify_strike": row["notify_strike"] != 0,
    }


def save_alert_settings(
    user_id: int,
    *,
    discord_webhook: str | None = None,
    enabled: bool | None = None,
    clear_webhook: bool = False,
    notify_early: bool | None = None,
    notify_strike: bool | None = None,
) -> dict:
    """Update only what's given. Raises AlertError for a URL that isn't a Discord webhook."""
    values: dict = {}
    if clear_webhook:
        values["discord_webhook"] = None
        values["enabled"] = 0
        values["last_error"] = None
    elif discord_webhook is not None:
        url = discord_webhook.strip()
        if not valid_webhook(url):
            raise AlertError("That isn't a Discord webhook URL. It should start with https://discord.com/api/webhooks/")
        values["discord_webhook"] = url
        values["last_error"] = None
    if enabled is not None and not clear_webhook:
        values["enabled"] = 1 if enabled else 0
    if notify_early is not None:
        values["notify_early"] = 1 if notify_early else 0
    if notify_strike is not None:
        values["notify_strike"] = 1 if notify_strike else 0
    with get_engine().begin() as conn:
        if values and conn.execute(update(alert_settings).where(alert_settings.c.id == user_id).values(**values)).rowcount == 0:
            conn.execute(insert(alert_settings).values(id=user_id, **{"enabled": 0, **values}))
    current = load_alert_settings(user_id)
    if current["enabled"] and not current["discord_webhook"]:
        raise AlertError("Add a Discord webhook URL before turning alerts on.")
    return current


def _mark_checked(user_id: int) -> None:
    with get_engine().begin() as conn:
        if conn.execute(update(alert_settings).where(alert_settings.c.id == user_id).values(last_check_at=_now())).rowcount == 0:
            conn.execute(insert(alert_settings).values(id=user_id, enabled=0, last_check_at=_now()))


def _record_error(user_id: int, message: str | None) -> None:
    """Remember why the account's last message couldn't be sent (None: it was), for the app to show."""
    with get_engine().begin() as conn:
        conn.execute(update(alert_settings).where(alert_settings.c.id == user_id)
                     .values(last_error=message[:300] if message else None))


def check_overdue(settings: dict, now: datetime | None = None) -> bool:
    """
    Alerts are on, but the scheduled check hasn't run when it should have: the
    market has been open with current prices, the first check of the day was
    due at 9:45, and none has run for longer than OVERDUE_AFTER. Then nothing
    can be sent.
    """
    if not settings["enabled"] or not settings["discord_webhook"]:
        return False
    n = (now or datetime.now(timezone.utc)).astimezone(NEW_YORK)
    if not market_hours.delayed_quotes_live(n):
        return False
    since = datetime.combine(n.date(), OPEN, tzinfo=NEW_YORK) + QUOTE_DELAY
    if settings.get("last_check_at"):
        try:
            since = max(since, datetime.fromisoformat(settings["last_check_at"]).astimezone(NEW_YORK))
        except ValueError:
            pass
    return n - since > OVERDUE_AFTER


# --- Sending -------------------------------------------------------------------

def send_discord(url: str, payload: dict) -> None:
    """Post a message to a Discord webhook. Raises AlertError if Discord says no."""
    try:
        r = requests.post(url, json={"username": "CovCall", **payload}, timeout=10)
    except requests.RequestException as e:
        raise AlertError(f"Couldn't reach Discord: {e.__class__.__name__}") from e
    if r.status_code == 404:
        raise AlertError("Discord says this webhook doesn't exist (it may have been deleted). Create a new one and paste it again.")
    if r.status_code >= 400:
        raise AlertError(f"Discord refused the message (HTTP {r.status_code}).")


def _money(v: float) -> str:
    return f"${v:,.2f}"


def _limit_line(c: dict) -> str:
    """The limit price to buy back at: the target at the closest cent."""
    if not c.get("buyback_price"):
        return ""
    return (f"Buy back at **{_money(c['buyback_price'])}**/share or less, the closest cent to your target "
            f"({c['buyback_kept_pct']:.1f}% kept).\n")


def _plural(n: int, word: str) -> str:
    return f"{n} {word}{'' if n == 1 else 's'}"


def _day(iso: str) -> str:
    d = datetime.strptime(iso, "%Y-%m-%d")
    return f"{d:%b} {d.day}"   # "Oct 8"; "%-d" isn't supported on Windows


def _event_line(event: dict | None) -> str:
    if not event:
        return ""
    what = "Earnings" if event["kind"] == "earnings" else "The Fed's rate decision"
    return f"{what} on {_day(event['date'])} comes before expiry, so the earlier target applies.\n"


def _fields(c: dict) -> list[dict]:
    return [
        {"name": "Expires", "value": c["expiry"], "inline": True},
        {"name": "Sold at", "value": f"{_money(c['entry_price'])}/share", "inline": True},
        {"name": "Now", "value": f"{_money(c['current_price'])}/share", "inline": True},
    ]


def _buyback_embed(c: dict) -> dict:
    return {
        "title": f"Buy back now: {c['ticker']} {_money(c['strike'])} call",
        "color": GREEN,
        "description": (
            f"You've kept **{c['profit_capture_pct']:.0f}%** of the premium (your target is {c['target_pct']:.0f}%).\n"
            + _limit_line(c)
            + _event_line(c.get("event"))
            + f"Buying back {_plural(c['contracts'], 'contract')} costs about **{_money(c['cost_to_close'])}**."
        ),
        "fields": _fields(c),
    }


def _early_embed(c: dict) -> dict:
    e = c["early_exercise"]
    return {
        "title": f"May be exercised early: {c['ticker']} {_money(c['strike'])} call",
        "color": AMBER,
        "description": (
            f"{c['ticker']} goes ex-dividend on {_day(e['ex_dividend_date'])} and pays about {_money(e['dividend'])} a share. "
            f"The call has {_money(e['time_value'])} of time value left, less than the dividend, so the buyer may "
            f"exercise on {_day(e['exercise_by'])} to collect it.\n"
            f"To keep your shares, buy back or roll by **{_day(e['exercise_by'])}**."
        ),
        "fields": _fields(c),
    }


def _strike_embed(c: dict) -> dict:
    above = (c["stock_price"] / float(c["strike"]) - 1) * 100
    return {
        "title": f"{c['ticker']} is above your {_money(c['strike'])} strike",
        "color": RED,
        "description": (
            f"{c['ticker']} is at {_money(c['stock_price'])}, {above:.1f}% above the strike.\n"
            f"Buy back ({_plural(c['contracts'], 'contract')}, about **{_money(c['cost_to_close'])}**), roll it, or let the "
            f"shares be called away at {_money(c['strike'])}. Positions shows each choice in dollars."
        ),
        "fields": _fields(c),
    }


def alert_message(ready: list[dict] = (), early: list[dict] = (), above: list[dict] = ()) -> dict:
    """One Discord message for every call that newly needs you, most urgent first."""
    embeds = [*map(_early_embed, early), *map(_strike_embed, above), *map(_buyback_embed, ready)]
    parts = []
    if early:
        parts.append(f"{_plural(len(early), 'call')} may be exercised early")
    if above:
        parts.append(f"{_plural(len(above), 'call')} with the stock above the strike")
    if ready:
        parts.append(f"{_plural(len(ready), 'call')} ready to buy back")
    return {
        "content": f"**{' · '.join(parts)}.** Open Positions: {APP_URL}/positions",
        "embeds": embeds[:10],              # Discord allows 10 embeds per message
    }


def buyback_message(ready: list[dict]) -> dict:
    """One Discord message listing every call that just became ready to buy back."""
    return alert_message(ready=ready)


def send_test(user_id: int, url: str | None = None) -> None:
    url = url or load_alert_settings(user_id)["discord_webhook"]
    if not url:
        raise AlertError("Add a Discord webhook URL first.")
    if not valid_webhook(url):
        raise AlertError("That isn't a Discord webhook URL.")
    send_discord(url, {
        "content": "✅ CovCall alerts are connected. You'll get a message here when a covered call needs you.",
    })
    _record_error(user_id, None)   # it works now


# --- The check -----------------------------------------------------------------

def accounts_with_alerts() -> list[int]:
    """Accounts that have alerts on (unclaimed data from before accounts never gets any)."""
    with get_engine().connect() as conn:
        return [r.id for r in conn.execute(
            select(alert_settings.c.id).where(alert_settings.c.enabled == 1, alert_settings.c.id != UNCLAIMED)
            .order_by(alert_settings.c.id)
        )]


def check_all(*, force: bool = False) -> dict:
    """The scheduled check: every account with alerts on, one at a time; one failing doesn't stop the rest."""
    if not force and not delayed_quotes_live():
        return {"status": "market_closed", "sent": 0, "accounts": 0}
    sent = failed = 0
    accounts = accounts_with_alerts()
    for user_id in accounts:
        try:
            sent += check_and_alert(user_id, force=force)["sent"]
        except Exception as e:                  # a deleted webhook, Discord down, prices unavailable
            failed += 1
            log.warning("Alert check for account %s failed: %s", user_id, e)
    return {"status": "ok", "sent": sent, "accounts": len(accounts), "failed": failed}


def check_and_alert(user_id: int, *, force: bool = False) -> dict:
    """
    Check the account's open calls and send one Discord message for any that
    newly need it. Skips when alerts are off, and (unless force) when the
    market is closed or opened less than 15 minutes ago, since the delayed
    prices then are still the last session's closing quotes.
    """
    settings = load_alert_settings(user_id)
    if not settings["enabled"] or not settings["discord_webhook"]:
        return {"status": "off", "sent": 0}
    if not force and not delayed_quotes_live():
        return {"status": "market_closed", "sent": 0}

    open_positions = load_open_positions(user_id)
    config = effective_config(user_id)
    results = evaluate_positions(open_positions, config=config) if open_positions else []
    _mark_checked(user_id)

    ready, early, above = [], [], []
    for pos, r in zip(open_positions, results, strict=True):
        c = {**pos, "profit_capture_pct": r.profit_capture_pct, "current_price": r.current_option_price,
             "cost_to_close": r.cost_to_close, "target_pct": r.target_pct, "event": r.event,
             "buyback_price": r.buyback_price, "buyback_kept_pct": r.buyback_kept_pct,
             "stock_price": r.stock_price, "early_exercise": r.early_exercise}
        if r.should_buy_back and r.current_option_price > 0 and not pos.get("buyback_alerted_at"):
            ready.append(c)
        # Early exercise says more than "above the strike" (it always is), so it's sent instead
        if r.early_exercise and settings["notify_early"] and not pos.get("early_alerted_at"):
            early.append(c)
        elif (settings["notify_strike"] and r.stock_price and r.stock_price > float(pos["strike"])
              and not r.early_exercise and not pos.get("strike_alerted_at")):
            above.append(c)
    if not (ready or early or above):
        return {"status": "ok", "checked": len(open_positions), "sent": 0}

    try:
        send_discord(settings["discord_webhook"], alert_message(ready, early, above))
    except AlertError as e:
        _record_error(user_id, str(e))
        raise
    _record_error(user_id, None)
    now = _now()
    with get_engine().begin() as conn:
        for calls, values in ((ready, {"buyback_alerted_at": now}),
                              (early, {"early_alerted_at": now, "strike_alerted_at": now}),
                              (above, {"strike_alerted_at": now})):
            if calls:
                conn.execute(update(positions).where(positions.c.id.in_([c["id"] for c in calls])).values(**values))
    sent = len(ready) + len(early) + len(above)
    log.info("Sent alerts for %d call(s): %d ready, %d early exercise, %d above strike", sent, len(ready), len(early), len(above))
    return {"status": "ok", "checked": len(open_positions), "sent": sent}


if __name__ == "__main__":                       # python -m core.alerts
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    try:
        print(check_all())
    except AlertError as e:
        log.error("Alert check failed: %s", e)
        raise SystemExit(1) from e
