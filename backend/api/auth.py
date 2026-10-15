# api/auth.py
"""
Password protection for the API.

Set APP_PASSWORD (e.g. on Railway) to require a login. The app's login screen
sends the password to POST /auth/login and gets back a signed token, which it
sends as "Authorization: Bearer <token>" on every request. Tokens last
AUTH_TOKEN_DAYS days (default 30) and are signed with AUTH_SECRET (defaults to
one derived from the password, so changing the password logs everyone out).

When APP_PASSWORD is not set the API stays open (handy for local development)
and a warning is logged at startup.

After MAX_FAILURES wrong passwords within LOCKOUT_SECONDS, logins are refused
(429) until the oldest of them is that old. It's one limit for everyone: behind
Railway's proxy every request comes from the same address. Devices already
logged in keep working, since their tokens are still valid.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import math
import os
import threading
import time
from collections import deque

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

log = logging.getLogger(__name__)

TOKEN_DAYS = float(os.environ.get("AUTH_TOKEN_DAYS", "30"))

MAX_FAILURES = 10
LOCKOUT_SECONDS = 15 * 60
_failures: deque[float] = deque()     # when each recent wrong password was tried
_failures_lock = threading.Lock()


def _locked_for(now: float) -> int:
    """Seconds until a login may be tried again (0: now)."""
    with _failures_lock:
        while _failures and now - _failures[0] >= LOCKOUT_SECONDS:
            _failures.popleft()
        if len(_failures) < MAX_FAILURES:
            return 0
        return math.ceil(LOCKOUT_SECONDS - (now - _failures[0]))


def _password() -> str:
    return os.environ.get("APP_PASSWORD", "")


def auth_required() -> bool:
    return bool(_password())


def _secret() -> bytes:
    explicit = os.environ.get("AUTH_SECRET", "")
    if explicit:
        return explicit.encode()
    return hashlib.sha256(b"covcall-auth:" + _password().encode()).digest()


def _sign(payload: str) -> str:
    sig = hmac.new(_secret(), payload.encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(sig).decode().rstrip("=")


def make_token(now: float | None = None) -> tuple[str, int]:
    """A signed token and its expiry (unix seconds)."""
    expires = int((now or time.time()) + TOKEN_DAYS * 86400)
    payload = str(expires)
    return f"{payload}.{_sign(payload)}", expires


def token_is_valid(token: str, now: float | None = None) -> bool:
    payload, _, sig = (token or "").partition(".")
    if not payload.isdigit() or not sig:
        return False
    if not hmac.compare_digest(sig, _sign(payload)):
        return False
    return int(payload) > (now or time.time())


_bearer = HTTPBearer(auto_error=False)


def require_auth(creds: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> None:
    """Route dependency: reject the request unless it carries a valid token."""
    if not auth_required():
        return
    if creds is None or not token_is_valid(creds.credentials):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Please log in.",
            headers={"WWW-Authenticate": "Bearer"},
        )


# ---------------------------------------------------------------------------
# /auth routes (always public)

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    password: str


class LoginResponse(BaseModel):
    token: str
    expires_at: int


@router.get("/status")
def auth_status():
    """Whether this API needs a password."""
    return {"auth_required": auth_required()}


@router.post("/login", response_model=LoginResponse)
def login(body: LoginRequest):
    if not auth_required():
        token, expires = make_token()
        return LoginResponse(token=token, expires_at=expires)
    now = time.time()
    wait = _locked_for(now)
    if wait:
        minutes = math.ceil(wait / 60)
        raise HTTPException(
            status_code=429,
            detail=f"Too many wrong passwords. Try again in {minutes} minute{'' if minutes == 1 else 's'}.",
            headers={"Retry-After": str(wait)},
        )
    if not hmac.compare_digest(body.password.encode(), _password().encode()):
        with _failures_lock:
            _failures.append(now)
        log.warning("Wrong password at login")
        time.sleep(1)  # slow down password guessing
        raise HTTPException(status_code=401, detail="Wrong password.")
    with _failures_lock:
        _failures.clear()
    token, expires = make_token()
    return LoginResponse(token=token, expires_at=expires)


def warn_if_open() -> None:
    if not auth_required():
        log.warning("APP_PASSWORD is not set: the API is open to anyone who can reach it.")
