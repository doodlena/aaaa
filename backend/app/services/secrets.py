"""Encryption at rest for secrets stored in the database (e.g. an admin-uploaded Anthropic API key).

Key material: FOODACCESS_SECRET_KEY (a Fernet key) if set — required in production — otherwise a local key file
data/secret.key created with 0600 permissions on first use (development convenience; git-ignored).
"""
import os

from cryptography.fernet import Fernet, InvalidToken

from app.config import get_settings


class SecretUnavailable(Exception):
    pass


def _fernet() -> Fernet:
    s = get_settings()
    key = s.secret_key
    if not key:
        if s.environment == "production":
            raise SecretUnavailable("Set FOODACCESS_SECRET_KEY to store secrets in production")
        path = s.data_dir / "secret.key"
        if not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "wb") as fh:
                fh.write(Fernet.generate_key())
        key = path.read_text().strip()
    return Fernet(key.encode() if isinstance(key, str) else key)


def encrypt(value: str) -> str:
    return _fernet().encrypt(value.encode()).decode()


def decrypt(token: str) -> str:
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken as e:
        raise SecretUnavailable("Stored secret cannot be decrypted (was FOODACCESS_SECRET_KEY changed?)") from e
