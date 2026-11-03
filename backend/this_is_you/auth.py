"""One person's passphrase and their signed-in devices.

The passphrase can only be set from the command line. No web route can create or replace it, so nothing that merely
reaches the service can claim an archive that has none yet. Sessions are stored as hashes, so a copy of the database
holds nothing that could be replayed as a cookie.
"""
from __future__ import annotations

import hashlib
import hmac
import secrets
import threading
import time
import unicodedata

from sqlalchemy import delete, select
from sqlalchemy.orm import sessionmaker

from .documents import utc_now
from .models import AuthCredential, AuthSession

COOKIE = "tiy_session"
SECURE_COOKIE = "__Host-tiy_session"  # Browsers accept this name only over HTTPS, for this exact host and no subdomain.
MIN_PASSPHRASE = 12
MAX_PASSPHRASE = 1024  # Long enough for any passphrase, short enough that hashing one is not a way to tie up the service.
IDLE_SECONDS = 3 * 24 * 3600
ABSOLUTE_SECONDS = 14 * 24 * 3600
_TOUCH_EVERY = 60  # Seen-at does not need a database write on every request.
_SCRYPT = {"n": 2**17, "r": 8, "p": 1}
_MAXMEM = 256 * 1024 * 1024
_FREE_TRIES = 5
_LONGEST_WAIT = 300


class WeakPassphrase(ValueError):
    pass


def _normalized(passphrase: str) -> bytes:
    # The same words typed on a phone and a laptop can differ in Unicode form.
    return unicodedata.normalize("NFKC", passphrase).encode()


def _derive(passphrase: str, salt: bytes, n: int, r: int, p: int) -> bytes:
    return hashlib.scrypt(_normalized(passphrase), salt=salt, n=n, r=r, p=p, maxmem=_MAXMEM, dklen=32)


def is_configured(sessions: sessionmaker) -> bool:
    with sessions() as session:
        return session.get(AuthCredential, 1) is not None


def set_passphrase(sessions: sessionmaker, passphrase: str) -> None:
    """Replaces the passphrase and signs out every device."""
    if len(passphrase) < MIN_PASSPHRASE:
        raise WeakPassphrase(f"Use at least {MIN_PASSPHRASE} characters. Several unrelated words work well.")
    if len(_normalized(passphrase)) > MAX_PASSPHRASE:
        raise WeakPassphrase(f"Use at most {MAX_PASSPHRASE} characters.")
    salt = secrets.token_bytes(16)
    derived = _derive(passphrase, salt, **_SCRYPT)
    with sessions() as session:
        row = session.get(AuthCredential, 1)
        if row is None:
            row = AuthCredential(id=1)
            session.add(row)
        row.salt, row.derived, row.n, row.r, row.p, row.updated_at = salt.hex(), derived.hex(), _SCRYPT["n"], _SCRYPT["r"], _SCRYPT["p"], utc_now()
        session.execute(delete(AuthSession))
        session.commit()


def check_passphrase(sessions: sessionmaker, passphrase: str) -> bool:
    if len(passphrase) > MAX_PASSPHRASE * 4:
        return False
    with sessions() as session:
        row = session.get(AuthCredential, 1)
    if row is None:
        return False
    return hmac.compare_digest(_derive(passphrase, bytes.fromhex(row.salt), row.n, row.r, row.p), bytes.fromhex(row.derived))


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_session(sessions: sessionmaker) -> str:
    token = secrets.token_urlsafe(32)
    now = int(time.time())
    with sessions() as session:
        session.execute(delete(AuthSession).where(AuthSession.last_seen_at < now - IDLE_SECONDS))
        session.add(AuthSession(token_hash=_hash_token(token), created_at=now, last_seen_at=now))
        session.commit()
    return token


def session_is_valid(sessions: sessionmaker, token: str | None) -> bool:
    if not token:
        return False
    now = int(time.time())
    with sessions() as session:
        row = session.get(AuthSession, _hash_token(token))
        if row is None:
            return False
        if now - row.last_seen_at > IDLE_SECONDS or now - row.created_at > ABSOLUTE_SECONDS:
            session.delete(row)
            session.commit()
            return False
        if now - row.last_seen_at > _TOUCH_EVERY:
            row.last_seen_at = now
            session.commit()
    return True


def end_session(sessions: sessionmaker, token: str | None) -> None:
    if token:
        with sessions() as session:
            session.execute(delete(AuthSession).where(AuthSession.token_hash == _hash_token(token)))
            session.commit()


def end_all_sessions(sessions: sessionmaker) -> None:
    with sessions() as session:
        session.execute(delete(AuthSession))
        session.commit()


def count_sessions(sessions: sessionmaker) -> int:
    with sessions() as session:
        return len(session.scalars(select(AuthSession.token_hash)).all())


class LoginThrottle:
    """Slows guessing. One person, so one counter. Someone guessing can delay a real sign-in by at most five minutes at a time."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._hashing = threading.Lock()  # One expensive hash at a time, however many requests arrive.
        self._failures = 0
        self._until = 0.0

    def wait_seconds(self) -> int:
        with self._lock:
            return max(0, int(self._until - time.monotonic()) + 1) if time.monotonic() < self._until else 0

    def attempt(self, sessions: sessionmaker, passphrase: str) -> bool:
        with self._hashing:
            if self.wait_seconds():
                return False
            ok = check_passphrase(sessions, passphrase)
        with self._lock:
            if ok:
                self._failures, self._until = 0, 0.0
            else:
                self._failures += 1
                if self._failures >= _FREE_TRIES:
                    self._until = time.monotonic() + min(_LONGEST_WAIT, 2 ** (self._failures - _FREE_TRIES + 1))
        return ok
