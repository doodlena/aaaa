"""Session auth: Argon2 password hashes, opaque session tokens (stored hashed), CSRF tokens, login rate limiting."""
import hashlib
import secrets
import threading
import time
from collections import defaultdict, deque
from datetime import UTC, datetime, timedelta

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import Depends, HTTPException, Request, Response
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.models import User, UserSession

SESSION_COOKIE = "nfa_session"
CSRF_COOKIE = "nfa_csrf"
CSRF_HEADER = "x-csrf-token"

_hasher = PasswordHasher()
# Dummy hash so unknown-email logins take as long as wrong-password logins.
_DUMMY_HASH = _hasher.hash("timing-equalizer")


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(stored: str, password: str) -> bool:
    try:
        return _hasher.verify(stored, password)
    except (VerificationError, InvalidHashError):
        return False


def burn_verify(password: str) -> None:
    verify_password(_DUMMY_HASH, password)


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class RateLimiter:
    """In-process sliding window. Good enough for a single API process; use a shared store if scaled out."""

    def __init__(self, limit: int, window_s: int):
        self.limit, self.window = limit, window_s
        self.hits: dict[str, deque] = defaultdict(deque)
        self.lock = threading.Lock()

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        with self.lock:
            q = self.hits[key]
            while q and now - q[0] > self.window:
                q.popleft()
            if len(q) >= self.limit:
                return False
            q.append(now)
            return True

    def reset(self) -> None:
        with self.lock:
            self.hits.clear()


login_limiter = RateLimiter(get_settings().login_attempts_per_15min, 15 * 60)


def create_session(db: Session, user: User, response: Response) -> UserSession:
    s = get_settings()
    token = secrets.token_urlsafe(32)
    sess = UserSession(
        token_hash=_token_hash(token),
        csrf_token=secrets.token_urlsafe(24),
        user_id=user.id,
        expires_at=datetime.now(UTC) + timedelta(days=s.session_days),
    )
    db.add(sess)
    db.commit()
    max_age = s.session_days * 86400
    response.set_cookie(SESSION_COOKIE, token, max_age=max_age, httponly=True, secure=s.cookie_secure, samesite="lax", path="/")
    # Readable by JS so the SPA can echo it in the X-CSRF-Token header (double-submit + server-side match).
    response.set_cookie(CSRF_COOKIE, sess.csrf_token, max_age=max_age, httponly=False, secure=s.cookie_secure, samesite="lax", path="/")
    return sess


def destroy_session(db: Session, request: Request, response: Response) -> None:
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        db.execute(delete(UserSession).where(UserSession.token_hash == _token_hash(token)))
        db.commit()
    response.delete_cookie(SESSION_COOKIE, path="/")
    response.delete_cookie(CSRF_COOKIE, path="/")


def _current_session(request: Request, db: Session) -> UserSession | None:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    sess = db.scalar(select(UserSession).where(UserSession.token_hash == _token_hash(token)))
    if not sess or sess.expires_at < datetime.now(UTC):
        return None
    return sess


def optional_user(request: Request, db: Session = Depends(get_db)) -> User | None:
    sess = _current_session(request, db)
    return db.get(User, sess.user_id) if sess else None


def require_user(request: Request, db: Session = Depends(get_db)) -> User:
    sess = _current_session(request, db)
    if not sess:
        raise HTTPException(401, "Sign-in required")
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        header = request.headers.get(CSRF_HEADER, "")
        if not secrets.compare_digest(header, sess.csrf_token):
            raise HTTPException(403, "CSRF token missing or invalid")
    user = db.get(User, sess.user_id)
    if not user:
        raise HTTPException(401, "Sign-in required")
    request.state.user = user
    return user


def require_admin(user: User = Depends(require_user)) -> User:
    if user.role != "admin":
        raise HTTPException(403, "Administrator access required")
    return user
