"""OAuth (OpenID Connect) sign-in. The provider is faked in-process: no live websites."""
import base64
import json
import time
from urllib.parse import parse_qs, urlparse

import pytest
from sqlalchemy import select

from app.auth import oauth
from app.config import get_settings
from app.models import OAuthIdentity, User
from tests.conftest import USER_PW, login, make_user

ISSUER = "https://id.example.org"


def _jwt(claims: dict) -> str:
    part = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=").decode()  # noqa: E731
    return f"{part({'alg': 'none'})}.{part(claims)}.sig"


@pytest.fixture
def provider(monkeypatch):
    """A fake provider. `person` is who signs in; tests change it or the token claims to simulate failures."""
    s = get_settings()
    monkeypatch.setattr(s, "oidc_issuer", ISSUER)
    monkeypatch.setattr(s, "oidc_client_id", "client-1")
    monkeypatch.setattr(s, "oidc_client_secret", "secret-1")
    monkeypatch.setattr(s, "oidc_provider_name", "Example ID")
    state = {"person": {"sub": "abc-123", "email": "Fam@Example.org", "email_verified": True}, "claims": {}, "nonce": None, "seen": {}}
    monkeypatch.setattr(oauth, "fetch_discovery", lambda: {
        "issuer": ISSUER, "authorization_endpoint": f"{ISSUER}/authorize", "token_endpoint": f"{ISSUER}/token",
        "userinfo_endpoint": f"{ISSUER}/userinfo"})

    def exchange(code, verifier):
        state["seen"] = {"code": code, "verifier": verifier}
        claims = {"iss": ISSUER, "aud": "client-1", "sub": state["person"]["sub"], "exp": time.time() + 300, "nonce": state["nonce"]}
        return {"access_token": "at-1", "id_token": _jwt({**claims, **state["claims"]})}

    monkeypatch.setattr(oauth, "exchange_code", exchange)
    monkeypatch.setattr(oauth, "fetch_userinfo", lambda token: state["person"])
    return state


def start(client, provider, **body):
    r = client.post("/api/auth/oauth/start", json=body, headers={"X-CSRF-Token": client.cookies.get("nfa_csrf", "")})
    assert r.status_code == 200, r.text
    q = parse_qs(urlparse(r.json()["url"]).query)
    provider["nonce"] = q["nonce"][0]
    return q


def finish(client, state, code="code-1", **extra):
    return client.post("/api/auth/oauth/callback", json={"code": code, "state": state, **extra},
                       headers={"X-CSRF-Token": client.cookies.get("nfa_csrf", "")})


def test_oauth_is_off_by_default(client):
    assert client.get("/api/meta/features").json()["oauth"] == {"enabled": False, "provider": ""}
    assert client.post("/api/auth/oauth/start", json={}).status_code == 404
    assert client.post("/api/auth/oauth/callback", json={"code": "c", "state": "s"}).status_code == 404


def test_oauth_sign_in_creates_account_then_reuses_it(client, db, provider):
    assert client.get("/api/meta/features").json()["oauth"] == {"enabled": True, "provider": "Example ID"}
    q = start(client, provider)
    assert q["response_type"] == ["code"] and q["scope"] == ["openid email"] and q["code_challenge_method"] == ["S256"]
    assert q["redirect_uri"] == ["http://localhost:5173/auth/callback"] and q["client_id"] == ["client-1"]
    r = finish(client, q["state"][0], preferred_language="vi")
    assert r.status_code == 200, r.text
    assert r.json() | {"id": 0} == {"id": 0, "email": "fam@example.org", "role": "user", "preferred_language": "vi", "preferences": {},
                                    "has_password": False, "oauth_linked": True}
    assert provider["seen"]["code"] == "code-1" and len(provider["seen"]["verifier"]) >= 32  # PKCE verifier sent on exchange
    assert client.get("/api/auth/me").json()["user"]["email"] == "fam@example.org"
    # no usable password is stored, so password login can never match
    assert db.scalar(select(User).where(User.email == "fam@example.org")).password_hash == oauth.UNUSABLE_PASSWORD
    assert client.post("/api/auth/login", json={"email": "fam@example.org", "password": "!"}).status_code == 401

    client.post("/api/auth/logout")
    provider["person"]["email"] = "renamed@example.org"  # the provider subject, not the email, identifies the account
    q = start(client, provider)
    assert finish(client, q["state"][0]).json()["email"] == "fam@example.org"
    assert len(db.scalars(select(User)).all()) == 1 and len(db.scalars(select(OAuthIdentity)).all()) == 1


def test_oauth_rejects_forged_or_replayed_responses(client, db, provider):
    assert finish(client, "anything").status_code == 400  # no flow was started in this browser
    q = start(client, provider)
    assert finish(client, "not-the-state").status_code == 400  # state mismatch (login CSRF)
    assert finish(client, q["state"][0]).status_code == 400  # the flow cookie is single-use

    for claims in ({"nonce": "other"}, {"aud": "someone-else"}, {"iss": "https://evil.example"}, {"exp": time.time() - 5},
                   {"sub": "different-person"}):
        provider["claims"] = claims
        q = start(client, provider)
        assert finish(client, q["state"][0]).status_code == 400, claims
    provider["claims"] = {}

    provider["person"]["email_verified"] = False
    q = start(client, provider)
    assert finish(client, q["state"][0]).status_code == 400
    assert db.scalars(select(User)).all() == [] and "nfa_session" not in client.cookies


def test_oauth_never_adopts_a_password_account_by_email(client, db, provider):
    make_user(db, "fam@example.org", USER_PW)
    q = start(client, provider)
    r = finish(client, q["state"][0])
    assert r.status_code == 409 and "nfa_session" not in client.cookies
    assert db.scalars(select(OAuthIdentity)).all() == []

    # the owner signs in with the password and connects the provider; after that the provider signs them in
    login(client, "fam@example.org", USER_PW)
    q = start(client, provider, link=True)
    r = finish(client, q["state"][0])
    assert r.status_code == 200 and r.json()["oauth_linked"] is True and r.json()["has_password"] is True
    client.post("/api/auth/logout")
    q = start(client, provider)
    assert finish(client, q["state"][0]).json()["email"] == "fam@example.org"


def test_oauth_link_needs_a_session_and_one_account_per_identity(client, db, provider):
    q = start(client, provider, link=True)
    assert finish(client, q["state"][0]).status_code == 401  # linking without being signed in

    q = start(client, provider)
    assert finish(client, q["state"][0]).status_code == 200  # creates fam@example.org
    client.post("/api/auth/logout")
    make_user(db, "other@example.org", USER_PW)
    login(client, "other@example.org", USER_PW)
    q = start(client, provider, link=True)
    assert finish(client, q["state"][0]).status_code == 409  # identity already belongs to another account


def test_oauth_account_can_be_deleted_without_a_password(client, db, provider):
    q = start(client, provider)
    finish(client, q["state"][0])
    assert client.request("DELETE", "/api/me", json={}).status_code == 403  # CSRF token still required
    r = client.request("DELETE", "/api/me", json={}, headers={"X-CSRF-Token": client.cookies["nfa_csrf"]})
    assert r.status_code == 204
    assert db.scalars(select(User)).all() == [] and db.scalars(select(OAuthIdentity)).all() == []
