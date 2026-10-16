# accounts.py
"""
Accounts: an email and a password hash per person (db.users), and the data
from before accounts existed, kept as unclaimed (db.UNCLAIMED) until one
account takes it over (api/auth.py decides who may).
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import re
from datetime import datetime, timezone

from sqlalchemy import delete, func, insert, select, update
from sqlalchemy.exc import IntegrityError

from core.db import UNCLAIMED, alert_settings, get_engine, holdings, positions, strategy, users
from core.strategy import forget as forget_strategy

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
MIN_PASSWORD = 10

# scrypt settings: about 16 MB and a few tens of milliseconds per hash
_N, _R, _P = 2 ** 14, 8, 1


class AccountError(ValueError):
    """Something about the email or password the person can fix (the message says what)."""


class AccountExists(AccountError):
    pass


def normalize_email(email: str) -> str:
    e = (email or "").strip().lower()
    if len(e) > 254 or not EMAIL_RE.match(e):
        raise AccountError("Enter an email address like you@example.com.")
    return e


def check_new_password(password: str) -> None:
    if len(password or "") < MIN_PASSWORD:
        raise AccountError(f"Use at least {MIN_PASSWORD} characters for your password.")
    if len(password) > 200:
        raise AccountError("Use at most 200 characters for your password.")


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=32)
    return f"scrypt${_N}${_R}${_P}${_b64(salt)}${_b64(digest)}"


def password_matches(password: str, stored: str) -> bool:
    try:
        kind, n, r, p, salt, digest = stored.split("$")
        if kind != "scrypt":
            return False
        got = hashlib.scrypt(password.encode(), salt=_unb64(salt), n=int(n), r=int(r), p=int(p), dklen=len(_unb64(digest)))
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(got, _unb64(digest))


def create_user(email: str, password: str) -> int:
    """A new account; raises AccountError for a bad email or password, AccountExists if the email is taken."""
    e = normalize_email(email)
    check_new_password(password)
    try:
        with get_engine().begin() as conn:
            return conn.execute(insert(users).values(
                email=e, password_hash=hash_password(password),
                created_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
            )).inserted_primary_key[0]
    except IntegrityError:
        raise AccountExists("There's already an account with this email. Log in instead.") from None


def find_user(email: str) -> dict | None:
    try:
        e = normalize_email(email)
    except AccountError:
        return None
    with get_engine().connect() as conn:
        row = conn.execute(select(users).where(users.c.email == e)).mappings().first()
    return dict(row) if row else None


def email_of(user_id: int) -> str | None:
    with get_engine().connect() as conn:
        return conn.execute(select(users.c.email).where(users.c.id == user_id)).scalar()


def account_count() -> int:
    with get_engine().connect() as conn:
        return int(conn.execute(select(func.count()).select_from(users)).scalar())


def has_unclaimed_data() -> bool:
    """Holdings, calls, a strategy or alert settings from before accounts existed."""
    with get_engine().connect() as conn:
        return any(conn.execute(select(t.c[col]).where(t.c[col] == UNCLAIMED).limit(1)).first() is not None
                   for t, col in ((holdings, "user_id"), (positions, "user_id"), (strategy, "id"), (alert_settings, "id")))


def claim_unclaimed_data(user_id: int) -> bool:
    """Give the data from before accounts to this account. Returns whether there was any."""
    if not has_unclaimed_data():
        return False
    with get_engine().begin() as conn:
        conn.execute(update(holdings).where(holdings.c.user_id == UNCLAIMED).values(user_id=user_id))
        conn.execute(update(positions).where(positions.c.user_id == UNCLAIMED).values(user_id=user_id))
        for table in (strategy, alert_settings):
            if conn.execute(select(table.c.id).where(table.c.id == UNCLAIMED)).first() is not None:
                conn.execute(delete(table).where(table.c.id == user_id))
                conn.execute(update(table).where(table.c.id == UNCLAIMED).values(id=user_id))
    forget_strategy(user_id)   # the in-memory copy of this account's strategy is out of date
    return True
