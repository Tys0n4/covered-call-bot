# api/routes/alerts.py
# Buy-back alerts to Discord (Strategy page). See core/alerts.py.
from fastapi import APIRouter, HTTPException

from core.alerts import AlertError, check_and_alert, load_alert_settings, save_alert_settings, send_test
from api.schemas import AlertSettingsIn, AlertSettingsOut, AlertCheckResult

router = APIRouter(prefix="/alerts", tags=["alerts"])


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
