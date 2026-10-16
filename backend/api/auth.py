# api/auth.py
"""
Accounts and logins.

Sign up (POST /auth/signup) or log in (POST /auth/login) with an email and a
password to get a signed token. The app sends it as "Authorization: Bearer
<token>" on every request, and every route sees only that account's data
(current_user). Tokens last AUTH_TOKEN_DAYS days (default 30) and are signed
with AUTH_SECRET, or else with a key generated once and kept in the database.
Passwords are stored as scrypt hashes (core/accounts.py).

Each token carries the account's token version. Changing the password, using a
recovery code or "log out other devices" raises the version, so every older
token stops working; the device that did it gets a new one. The version is
looked up at most once a minute per account (VERSION_TTL), so a log-out reaches
other devices within a minute.

Forgot your password? There's no email, so each account has a recovery code,
shown once at sign-up (or at the next login for older accounts) and stored
only as a hash. POST /auth/recover sets a new password with it and returns a
new code.

Limits, kept in the database so they survive the server sleeping
(db.auth_limits): after MAX_FAILURES wrong passwords (or recovery codes) for an
email within LOCKOUT_SECONDS, that email is refused (429) until the window
passes, and one network address gets MAX_IP_FAILURES across all emails.
Devices already logged in keep working. Wrong guesses at the old app password
are limited the same way. Sign-ups are capped per hour, overall and per
address. Nothing here sleeps: a slow answer would hold one of the server's few
worker threads, so a burst of wrong passwords would stall everyone (scrypt is
already slow to guess).

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

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field
from sqlalchemy import delete, insert, select
from sqlalchemy.exc import IntegrityError

from core import accounts
from core.db import app_settings, auth_limits, get_engine

log = logging.getLogger(__name__)

TOKEN_DAYS = float(os.environ.get("AUTH_TOKEN_DAYS", "30"))
VERSION_TTL = 60                 # seconds an account's token version is trusted from memory
MAX_FAILURES = 10                # wrong passwords per email in LOCKOUT_SECONDS
MAX_IP_FAILURES = 50             # wrong passwords from one network address, across emails
LOCKOUT_SECONDS = 15 * 60
SIGNUPS_PER_HOUR = 30
SIGNUPS_PER_IP_PER_HOUR = 5


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


def make_token(user_id: int, version: int = 0, now: float | None = None) -> tuple[str, int]:
    """A signed token for the account at its current token version, and its expiry (unix seconds)."""
    expires = int((now or time.time()) + TOKEN_DAYS * 86400)
    payload = f"{user_id}.{version}.{expires}"
    return f"{payload}.{_sign(payload)}", expires


def _read_token(token: str, now: float | None = None) -> tuple[int, int] | None:
    """(account, token version) from a validly signed, unexpired token, else None. Tokens from
    before versions ("id.expires.sig") count as version 0."""
    parts = (token or "").split(".")
    if len(parts) == 4:
        user, version, expires, sig = parts
    elif len(parts) == 3:
        user, expires, sig = parts
        version = "0"
    else:
        return None
    if not (user.isdigit() and version.isdigit() and expires.isdigit() and sig):
        return None
    payload = ".".join(parts[:-1])
    if not hmac.compare_digest(sig, _sign(payload)):
        return None
    if int(expires) <= (now or time.time()):
        return None
    return int(user), int(version)


_versions: dict[int, tuple[int | None, float]] = {}   # account -> (token version or None if gone, when read)
_versions_lock = threading.Lock()


def _current_version(user_id: int) -> int | None:
    now = time.monotonic()
    with _versions_lock:
        hit = _versions.get(user_id)
    if hit and now - hit[1] < VERSION_TTL:
        return hit[0]
    version = accounts.token_version(user_id)
    with _versions_lock:
        _versions[user_id] = (version, now)
    return version


def _remember_version(user_id: int, version: int | None) -> None:
    with _versions_lock:
        _versions[user_id] = (version, time.monotonic())


def token_user(token: str, now: float | None = None) -> int | None:
    """The account a valid, unexpired, current token belongs to, else None."""
    read = _read_token(token, now)
    if read is None:
        return None
    user_id, version = read
    return user_id if _current_version(user_id) == version else None


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


def _issue(user_id: int, email: str, version: int, recovery_code: str | None = None, claimed: bool = False) -> LoginResponse:
    _remember_version(user_id, version)
    token, expires = make_token(user_id, version)
    return LoginResponse(token=token, expires_at=expires, email=email, claimed=claimed, recovery_code=recovery_code)


# --- Limits (db.auth_limits: one row per wrong guess or sign-up) -------------------

def _client_ip(request: Request) -> str:
    """The visitor's address: Railway's edge puts it in X-Real-IP."""
    return request.headers.get("x-real-ip") or (request.client.host if request.client else "unknown")


def _wait(key: str, limit: int, window: int, now: float) -> int:
    """Seconds until key may try again (0: now): it's had `limit` events in the last `window` seconds."""
    with get_engine().connect() as conn:
        times = conn.execute(
            select(auth_limits.c.at).where(auth_limits.c.key == key, auth_limits.c.at > now - window).order_by(auth_limits.c.at)
        ).scalars().all()
    if len(times) < limit:
        return 0
    return max(1, math.ceil(window - (now - times[-limit])))


def _record(now: float, *keys: str) -> None:
    with get_engine().begin() as conn:
        conn.execute(insert(auth_limits), [{"key": k, "at": now} for k in keys])
        conn.execute(delete(auth_limits).where(auth_limits.c.at < now - 3600))   # nothing looks back further


def _clear(key: str) -> None:
    with get_engine().begin() as conn:
        conn.execute(delete(auth_limits).where(auth_limits.c.key == key))


def _too_many(wait: int, what: str = "Too many wrong passwords") -> HTTPException:
    minutes = math.ceil(wait / 60)
    return HTTPException(
        status_code=429,
        detail=f"{what}. Try again in {minutes} minute{'' if minutes == 1 else 's'}.",
        headers={"Retry-After": str(wait)},
    )


def _guard(email: str, ip: str, now: float) -> None:
    """Refuse (429) while this email or this address has had too many wrong guesses."""
    wait = _wait(f"login:{email}", MAX_FAILURES, LOCKOUT_SECONDS, now)
    if wait:
        raise _too_many(wait)
    wait = _wait(f"ip:{ip}", MAX_IP_FAILURES, LOCKOUT_SECONDS, now)
    if wait:
        raise _too_many(wait, "Too many wrong passwords from this network")


def _wrong(email: str, ip: str, now: float) -> None:
    _record(now, f"login:{email}", f"ip:{ip}")


def _take_signup_slot(ip: str, now: float) -> None:
    if _wait("signup", SIGNUPS_PER_HOUR, 3600, now):
        raise HTTPException(status_code=429, detail="Too many new accounts right now. Try again in an hour.")
    if _wait(f"signup:{ip}", SIGNUPS_PER_IP_PER_HOUR, 3600, now):
        raise HTTPException(status_code=429, detail="Too many new accounts from this network. Try again in an hour.")
    _record(now, "signup", f"signup:{ip}")


# --- /auth routes (public, except the ones that take current_user) ---------------

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(max_length=200)


class SignupRequest(LoginRequest):
    claim_password: str | None = Field(default=None, max_length=200)   # the old shared app password, to keep that data


class RecoverRequest(BaseModel):
    email: str = Field(max_length=254)
    recovery_code: str = Field(max_length=40)
    new_password: str = Field(max_length=200)


class PasswordChange(BaseModel):
    current_password: str = Field(max_length=200)
    new_password: str = Field(max_length=200)


class PasswordConfirm(BaseModel):
    password: str = Field(max_length=200)


class LoginResponse(BaseModel):
    token: str
    expires_at: int
    email: str
    claimed: bool = False               # took over the data from before accounts
    recovery_code: str | None = None    # a new recovery code to show once (sign-up, first login, recovery)


@router.get("/status")
def auth_status():
    """Accounts are always on. can_claim: there's data from before accounts that the old app password can take over."""
    return {"auth_required": True, "can_claim": bool(_old_password()) and accounts.has_unclaimed_data()}


@router.post("/signup", response_model=LoginResponse, status_code=201)
def signup(body: SignupRequest, request: Request):
    old = _old_password()
    wants_claim = bool(body.claim_password)
    now = time.time()
    if wants_claim:
        wait = _wait("claim", MAX_FAILURES, LOCKOUT_SECONDS, now)
        if wait:
            raise _too_many(wait)
        if not (old and hmac.compare_digest(body.claim_password.encode(), old.encode())):
            _record(now, "claim")
            raise HTTPException(status_code=403, detail="That isn't the old app password. Leave it empty to start fresh.")
    _take_signup_slot(_client_ip(request), now)
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
    code = accounts.new_recovery_code(user_id)
    return _issue(user_id, accounts.email_of(user_id), 0, recovery_code=code, claimed=claimed)


@router.post("/login", response_model=LoginResponse)
def login(body: LoginRequest, request: Request):
    email = (body.email or "").strip().lower()
    ip, now = _client_ip(request), time.time()
    _guard(email, ip, now)
    user = accounts.find_user(email)
    if user is None or not accounts.password_matches(body.password, user["password_hash"]):
        _wrong(email, ip, now)
        log.info("Wrong email or password at login")
        raise HTTPException(status_code=401, detail="Wrong email or password.")
    _clear(f"login:{email}")
    # Accounts from before recovery codes get theirs now, shown once
    code = None if user.get("recovery_hash") else accounts.new_recovery_code(user["id"])
    return _issue(user["id"], user["email"], int(user.get("token_version") or 0), recovery_code=code)


@router.post("/recover", response_model=LoginResponse)
def recover(body: RecoverRequest, request: Request):
    """Forgot your password: your recovery code sets a new one, logs out every other device and gives a new code."""
    email = (body.email or "").strip().lower()
    ip, now = _client_ip(request), time.time()
    _guard(email, ip, now)
    user = accounts.find_user(email)
    if user is None or not accounts.recovery_matches(body.recovery_code, user.get("recovery_hash")):
        _wrong(email, ip, now)
        raise HTTPException(status_code=401, detail="That email and recovery code don't match.")
    try:
        version = accounts.set_password(user["id"], body.new_password)
    except accounts.AccountError as e:
        raise HTTPException(status_code=422, detail=str(e)) from None
    _clear(f"login:{email}")
    return _issue(user["id"], user["email"], version, recovery_code=accounts.new_recovery_code(user["id"]))


def _confirm_password(user_id: int, password: str, request: Request) -> dict:
    """The logged-in account, once its password is confirmed (wrong guesses count like logins)."""
    email = accounts.email_of(user_id) or ""
    ip, now = _client_ip(request), time.time()
    _guard(email, ip, now)
    user = accounts.find_user(email)
    if user is None or not accounts.password_matches(password, user["password_hash"]):
        _wrong(email, ip, now)
        raise HTTPException(status_code=403, detail="That password isn't right.")
    return user


@router.get("/me")
def me(user_id: int = Depends(current_user)):
    """The logged-in account."""
    email = accounts.email_of(user_id)
    if email is None:
        raise HTTPException(status_code=401, detail="Please log in.")
    return {"email": email, "has_recovery_code": accounts.has_recovery_code(user_id)}


@router.post("/password", response_model=LoginResponse)
def change_password(body: PasswordChange, request: Request, user_id: int = Depends(current_user)):
    """A new password. Every other device is logged out; this one gets a new token."""
    user = _confirm_password(user_id, body.current_password, request)
    try:
        version = accounts.set_password(user_id, body.new_password)
    except accounts.AccountError as e:
        raise HTTPException(status_code=422, detail=str(e)) from None
    return _issue(user_id, user["email"], version)


@router.post("/logout-others", response_model=LoginResponse)
def logout_others(user_id: int = Depends(current_user)):
    """Log out every other device (a shared or lost one). This one gets a new token."""
    email = accounts.email_of(user_id)
    return _issue(user_id, email, accounts.bump_token_version(user_id))


@router.post("/recovery-code")
def make_recovery_code(body: PasswordConfirm, request: Request, user_id: int = Depends(current_user)):
    """A new recovery code (the old one stops working). Needs the password, so a stolen login can't make one."""
    _confirm_password(user_id, body.password, request)
    return {"recovery_code": accounts.new_recovery_code(user_id)}


@router.post("/account/delete")
def delete_account(body: PasswordConfirm, request: Request, user_id: int = Depends(current_user)):
    """Delete the account and everything in it: stocks, calls, strategy, alerts. Can't be undone."""
    user = _confirm_password(user_id, body.password, request)
    accounts.delete_account(user_id)
    _remember_version(user_id, None)
    _clear(f"login:{user['email']}")
    return {"deleted": True}
