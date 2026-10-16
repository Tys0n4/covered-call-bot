# api/auth.py
"""
Accounts and logins.

Sign up (POST /auth/signup) or log in (POST /auth/login) with an email and a
password to get a signed token. The app sends it as "Authorization: Bearer
<token>" on every request, and every route sees only that account's data
(current_user). Tokens last AUTH_TOKEN_DAYS days (default 30) and are signed
with AUTH_SECRET, or else with a key generated once and kept in the database.
Passwords are stored as scrypt hashes (core/accounts.py).

After MAX_FAILURES wrong passwords for an email within LOCKOUT_SECONDS, logins
to it are refused (429) until the window passes; devices already logged in keep
working. Wrong guesses at the old app password are limited the same way. Nothing
here sleeps: a slow answer would hold one of the server's few worker threads, so
a burst of wrong passwords would stall everyone (scrypt is already slow to guess).
Sign-ups are capped per hour so a script can't flood the free database.

Data from before accounts existed (one shared APP_PASSWORD) stays unclaimed
until someone signs up and enters that old password as claim_password; then
it's theirs. On a server without APP_PASSWORD (local development) the first
account takes it over.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import math
import os
import secrets
import threading
import time
from collections import deque

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field
from sqlalchemy import insert, select
from sqlalchemy.exc import IntegrityError

from core import accounts
from core.db import app_settings, get_engine

log = logging.getLogger(__name__)

TOKEN_DAYS = float(os.environ.get("AUTH_TOKEN_DAYS", "30"))

MAX_FAILURES = 10
LOCKOUT_SECONDS = 15 * 60
SIGNUPS_PER_HOUR = 30
CLAIM_KEY = "(old app password)"   # wrong guesses at the old password count here, like an email

_failures: dict[str, deque[float]] = {}   # email -> when each recent wrong password was tried
_signups: deque[float] = deque()
_limits_lock = threading.Lock()


def _old_password() -> str:
    """The shared password from before accounts; now only for claiming that data."""
    return os.environ.get("APP_PASSWORD", "")


# --- Signing tokens ---------------------------------------------------------------

_secret_kept: dict = {"engine": None, "value": None}
_secret_lock = threading.Lock()


def _secret() -> bytes:
    explicit = os.environ.get("AUTH_SECRET", "")
    if explicit:
        return explicit.encode()
    engine = get_engine()
    with _secret_lock:
        if _secret_kept["engine"] is engine:
            return _secret_kept["value"]
        with engine.begin() as conn:
            value = conn.execute(select(app_settings.c.value).where(app_settings.c.key == "auth_secret")).scalar()
        if value is None:
            value = secrets.token_urlsafe(48)
            try:
                with engine.begin() as conn:
                    conn.execute(insert(app_settings).values(key="auth_secret", value=value))
            except IntegrityError:          # another server process made one first: use theirs
                with engine.begin() as conn:
                    value = conn.execute(select(app_settings.c.value).where(app_settings.c.key == "auth_secret")).scalar()
        _secret_kept.update(engine=engine, value=value.encode())
        return _secret_kept["value"]


def _sign(payload: str) -> str:
    sig = hmac.new(_secret(), payload.encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(sig).decode().rstrip("=")


def make_token(user_id: int, now: float | None = None) -> tuple[str, int]:
    """A signed token for the account and its expiry (unix seconds)."""
    expires = int((now or time.time()) + TOKEN_DAYS * 86400)
    payload = f"{user_id}.{expires}"
    return f"{payload}.{_sign(payload)}", expires


def token_user(token: str, now: float | None = None) -> int | None:
    """The account a valid, unexpired token belongs to, else None."""
    parts = (token or "").split(".")
    if len(parts) != 3 or not parts[0].isdigit() or not parts[1].isdigit() or not parts[2]:
        return None
    if not hmac.compare_digest(parts[2], _sign(f"{parts[0]}.{parts[1]}")):
        return None
    if int(parts[1]) <= (now or time.time()):
        return None
    return int(parts[0])


_bearer = HTTPBearer(auto_error=False)


def current_user(creds: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> int:
    """Route dependency: the logged-in account's id, or 401."""
    user_id = token_user(creds.credentials) if creds else None
    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Please log in.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user_id


# --- Limits -----------------------------------------------------------------------

def _locked_for(email: str, now: float) -> int:
    """Seconds until this email may try a password again (0: now)."""
    with _limits_lock:
        tries = _failures.get(email)
        if not tries:
            return 0
        while tries and now - tries[0] >= LOCKOUT_SECONDS:
            tries.popleft()
        if not tries:
            _failures.pop(email, None)
            return 0
        if len(tries) < MAX_FAILURES:
            return 0
        return math.ceil(LOCKOUT_SECONDS - (now - tries[0]))


def _failed(key: str, now: float) -> None:
    with _limits_lock:
        _failures.setdefault(key, deque()).append(now)


def _too_many(wait: int) -> HTTPException:
    minutes = math.ceil(wait / 60)
    return HTTPException(
        status_code=429,
        detail=f"Too many wrong passwords. Try again in {minutes} minute{'' if minutes == 1 else 's'}.",
        headers={"Retry-After": str(wait)},
    )


def _take_signup_slot(now: float) -> None:
    with _limits_lock:
        while _signups and now - _signups[0] >= 3600:
            _signups.popleft()
        if len(_signups) >= SIGNUPS_PER_HOUR:
            raise HTTPException(status_code=429, detail="Too many new accounts right now. Try again in an hour.")
        _signups.append(now)


# --- /auth routes (public, except /auth/me) ----------------------------------------

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(max_length=200)


class SignupRequest(LoginRequest):
    claim_password: str | None = Field(default=None, max_length=200)   # the old shared app password, to keep that data


class LoginResponse(BaseModel):
    token: str
    expires_at: int
    email: str
    claimed: bool = False    # took over the data from before accounts


@router.get("/status")
def auth_status():
    """Accounts are always on. can_claim: there's data from before accounts that the old app password can take over."""
    return {"auth_required": True, "can_claim": bool(_old_password()) and accounts.has_unclaimed_data()}


@router.post("/signup", response_model=LoginResponse, status_code=201)
def signup(body: SignupRequest):
    old = _old_password()
    wants_claim = bool(body.claim_password)
    now = time.time()
    if wants_claim:
        wait = _locked_for(CLAIM_KEY, now)
        if wait:
            raise _too_many(wait)
        if not (old and hmac.compare_digest(body.claim_password.encode(), old.encode())):
            _failed(CLAIM_KEY, now)
            raise HTTPException(status_code=403, detail="That isn't the old app password. Leave it empty to start fresh.")
    _take_signup_slot(now)
    try:
        user_id = accounts.create_user(body.email, body.password)
    except accounts.AccountExists as e:
        raise HTTPException(status_code=409, detail=str(e)) from None
    except accounts.AccountError as e:
        raise HTTPException(status_code=422, detail=str(e)) from None
    # The old data goes to whoever proves they know the old password, or, with no old
    # password set (local development), to the first account
    claimed = False
    if wants_claim or (not old and accounts.account_count() == 1):
        claimed = accounts.claim_unclaimed_data(user_id)
    token, expires = make_token(user_id)
    return LoginResponse(token=token, expires_at=expires, email=accounts.email_of(user_id), claimed=claimed)


@router.post("/login", response_model=LoginResponse)
def login(body: LoginRequest):
    email = (body.email or "").strip().lower()
    now = time.time()
    wait = _locked_for(email, now)
    if wait:
        raise _too_many(wait)
    user = accounts.find_user(email)
    if user is None or not accounts.password_matches(body.password, user["password_hash"]):
        _failed(email, now)
        log.info("Wrong email or password at login")
        raise HTTPException(status_code=401, detail="Wrong email or password.")
    with _limits_lock:
        _failures.pop(email, None)
    token, expires = make_token(user["id"])
    return LoginResponse(token=token, expires_at=expires, email=user["email"])


@router.get("/me")
def me(user_id: int = Depends(current_user)):
    """The logged-in account."""
    email = accounts.email_of(user_id)
    if email is None:
        raise HTTPException(status_code=401, detail="Please log in.")
    return {"email": email}
