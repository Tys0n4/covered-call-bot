# alerts.py
"""
Buy-back alerts to Discord.

You paste a Discord webhook URL on the Strategy page (Discord: channel
settings → Integrations → Webhooks → New Webhook → Copy URL). A scheduled job
runs `check_and_alert()` during market hours; when an open call reaches your
"buy back" target it posts one message to that channel. Each call is alerted
once (positions.buyback_alerted_at).

Run a check by hand (e.g. from a cron job):  cd backend && python -m core.alerts
"""
from __future__ import annotations

import logging
import os
import re
from datetime import datetime, timezone

import requests
from sqlalchemy import insert, select, update

from core.buyback import evaluate_positions
from core.db import alert_settings, get_engine, positions
from core.market_hours import is_market_open
from core.positions import load_open_positions
from core.strategy import effective_config

log = logging.getLogger(__name__)

# Only real Discord webhooks: the server posts to this URL, so don't let it be anything else
WEBHOOK_RE = re.compile(r"^https://(?:(?:canary|ptb)\.)?discord(?:app)?\.com/api/webhooks/\d+/[\w-]+$")

# Where "Open Positions" in the message points
APP_URL = os.environ.get("APP_URL", "https://covered-call-bot.vercel.app").rstrip("/")

GREEN = 0x34EDB3


class AlertError(Exception):
    """A problem the user can fix (bad URL, Discord refused the message)."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def valid_webhook(url: str) -> bool:
    return bool(WEBHOOK_RE.match(url or ""))


# --- Settings ------------------------------------------------------------------

def load_alert_settings() -> dict:
    with get_engine().connect() as conn:
        row = conn.execute(select(alert_settings).where(alert_settings.c.id == 1)).mappings().first()
    if row is None:
        return {"discord_webhook": None, "enabled": False, "last_check_at": None}
    return {"discord_webhook": row["discord_webhook"], "enabled": bool(row["enabled"]), "last_check_at": row["last_check_at"]}


def save_alert_settings(*, discord_webhook: str | None = None, enabled: bool | None = None, clear_webhook: bool = False) -> dict:
    """Update only what's given. Raises AlertError for a URL that isn't a Discord webhook."""
    values: dict = {}
    if clear_webhook:
        values["discord_webhook"] = None
        values["enabled"] = 0
    elif discord_webhook is not None:
        url = discord_webhook.strip()
        if not valid_webhook(url):
            raise AlertError("That isn't a Discord webhook URL. It should start with https://discord.com/api/webhooks/")
        values["discord_webhook"] = url
    if enabled is not None and not clear_webhook:
        values["enabled"] = 1 if enabled else 0
    with get_engine().begin() as conn:
        if values and conn.execute(update(alert_settings).where(alert_settings.c.id == 1).values(**values)).rowcount == 0:
            conn.execute(insert(alert_settings).values(id=1, **{"enabled": 0, **values}))
    current = load_alert_settings()
    if current["enabled"] and not current["discord_webhook"]:
        raise AlertError("Add a Discord webhook URL before turning alerts on.")
    return current


def _mark_checked() -> None:
    with get_engine().begin() as conn:
        if conn.execute(update(alert_settings).where(alert_settings.c.id == 1).values(last_check_at=_now())).rowcount == 0:
            conn.execute(insert(alert_settings).values(id=1, enabled=0, last_check_at=_now()))


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


def _plural(n: int, word: str) -> str:
    return f"{n} {word}{'' if n == 1 else 's'}"


def buyback_message(ready: list[dict], target_pct: float) -> dict:
    """One Discord message listing every call that just became ready to buy back."""
    embeds = []
    for c in ready[:10]:                     # Discord allows 10 embeds per message
        embeds.append({
            "title": f"Buy back now: {c['ticker']} {_money(c['strike'])} call",
            "color": GREEN,
            "description": (
                f"You've kept **{c['profit_capture_pct']:.0f}%** of the premium (your target is {target_pct:.0f}%).\n"
                f"Buying back {_plural(c['contracts'], 'contract')} costs about **{_money(c['cost_to_close'])}**."
            ),
            "fields": [
                {"name": "Expires", "value": c["expiry"], "inline": True},
                {"name": "Sold at", "value": f"{_money(c['entry_price'])}/share", "inline": True},
                {"name": "Now", "value": f"{_money(c['current_price'])}/share", "inline": True},
            ],
        })
    count = len(ready)
    return {
        "content": f"**{_plural(count, 'call')} ready to buy back.** Open Positions: {APP_URL}/positions",
        "embeds": embeds,
    }


def send_test(url: str | None = None) -> None:
    url = url or load_alert_settings()["discord_webhook"]
    if not url:
        raise AlertError("Add a Discord webhook URL first.")
    if not valid_webhook(url):
        raise AlertError("That isn't a Discord webhook URL.")
    send_discord(url, {
        "content": "✅ CovCall alerts are connected. You'll get a message here when a covered call is ready to buy back.",
    })


# --- The check -----------------------------------------------------------------

def check_and_alert(*, force: bool = False) -> dict:
    """
    Check open calls and send one Discord message for any that newly reached
    the buy-back target. Skips when alerts are off, and (unless force) when the
    market is closed, since prices then are only last-close quotes.
    """
    settings = load_alert_settings()
    if not settings["enabled"] or not settings["discord_webhook"]:
        return {"status": "off", "sent": 0}
    if not force and not is_market_open():
        return {"status": "market_closed", "sent": 0}

    open_positions = load_open_positions()
    config = effective_config()
    results = evaluate_positions(open_positions, config=config) if open_positions else []
    _mark_checked()

    ready = [
        {**pos, "profit_capture_pct": r.profit_capture_pct, "current_price": r.current_option_price,
         "cost_to_close": r.cost_to_close}
        for pos, r in zip(open_positions, results, strict=True)
        if r.should_buy_back and r.current_option_price > 0 and not pos.get("buyback_alerted_at")
    ]
    if not ready:
        return {"status": "ok", "checked": len(open_positions), "sent": 0}

    send_discord(settings["discord_webhook"], buyback_message(ready, config.profit_capture_target_pct))
    with get_engine().begin() as conn:
        conn.execute(update(positions).where(positions.c.id.in_([c["id"] for c in ready])).values(buyback_alerted_at=_now()))
    log.info("Sent buy-back alert for %d call(s)", len(ready))
    return {"status": "ok", "checked": len(open_positions), "sent": len(ready)}


if __name__ == "__main__":                       # python -m core.alerts
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    try:
        print(check_and_alert())
    except AlertError as e:
        log.error("Alert check failed: %s", e)
        raise SystemExit(1) from e
