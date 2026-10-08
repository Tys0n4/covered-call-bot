# api/routes/alerts.py
# Buy-back alerts to Discord (Strategy page). See core/alerts.py.
import hmac
import logging
import os

from fastapi import APIRouter, BackgroundTasks, Header, HTTPException

from core.alerts import AlertError, check_and_alert, load_alert_settings, save_alert_settings, send_test
from api.schemas import AlertSettingsIn, AlertSettingsOut, AlertCheckResult

log = logging.getLogger(__name__)

router = APIRouter(prefix="/alerts", tags=["alerts"])

# Not behind the login: for an outside scheduler (cron-job.org), which can't
# log in. It needs the ALERTS_KEY setting instead, and can only run the check.
scheduler = APIRouter(prefix="/alerts", tags=["alerts"])


def _out(s: dict) -> AlertSettingsOut:
    url = s["discord_webhook"] or ""
    # Never send the full webhook back: anyone with it can post to your channel
    return AlertSettingsOut(
        enabled=s["enabled"],
        webhook_set=bool(url),
        webhook_hint=f"…{url[-6:]}" if url else None,
        last_check_at=s["last_check_at"],
    )


@router.get("", response_model=AlertSettingsOut)
def get_alerts():
    return _out(load_alert_settings())


@router.put("", response_model=AlertSettingsOut)
def update_alerts(body: AlertSettingsIn):
    """Save the webhook and/or turn alerts on or off. Only the fields you send change."""
    try:
        return _out(save_alert_settings(discord_webhook=body.discord_webhook, enabled=body.enabled, clear_webhook=body.clear_webhook))
    except AlertError as e:
        raise HTTPException(status_code=400, detail=str(e)) from None


@router.post("/test")
def test_alert():
    """Send a test message to the saved webhook."""
    try:
        send_test()
    except AlertError as e:
        raise HTTPException(status_code=400, detail=str(e)) from None
    return {"sent": True}


@router.post("/check", response_model=AlertCheckResult)
def run_check(force: bool = False):
    """
    Check open calls and alert any that just reached the buy-back target.
    Plain `def`: it fetches option prices over the network. Called by the
    scheduled job; force=true also checks outside market hours.
    """
    try:
        return check_and_alert(force=force)
    except AlertError as e:
        raise HTTPException(status_code=502, detail=str(e)) from None


def _scheduled_check() -> None:
    try:
        log.info("Scheduled alert check: %s", check_and_alert())
    except Exception as e:                      # a bad webhook, Discord down, prices unavailable
        log.warning("Scheduled alert check failed: %s", e)


@scheduler.post("/cron", status_code=202)
def run_scheduled_check(background: BackgroundTasks, x_alerts_key: str | None = Header(default=None)):
    """
    The same check as POST /alerts/check, for a scheduler that sends the
    X-Alerts-Key header (equal to the ALERTS_KEY setting). Answers right away
    and checks in the background, since free schedulers give up after ~30s.
    Off (404) while ALERTS_KEY isn't set.
    """
    key = os.environ.get("ALERTS_KEY", "")
    if not key:
        raise HTTPException(status_code=404, detail="Not Found")
    if not x_alerts_key or not hmac.compare_digest(x_alerts_key.encode(), key.encode()):
        raise HTTPException(status_code=401, detail="Wrong or missing X-Alerts-Key")
    background.add_task(_scheduled_check)
    return {"status": "started"}
