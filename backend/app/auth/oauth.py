"""Optional sign-in with an OpenID Connect provider (authorization code flow with PKCE, state and nonce).

Off unless FOODACCESS_OIDC_ISSUER, _CLIENT_ID and _CLIENT_SECRET are set. Works with any standards-compliant provider
(Google, Microsoft, or a self-hosted one such as Keycloak or Authentik). Only `sub`, `email` and `email_verified` are
read; no profile, name or picture is requested or stored.

An OAuth sign-in never takes over an existing password account by matching its email: local emails are not verified,
so the owner must sign in with the password and connect the provider from the account page.
"""
import base64
import hashlib
import json
import secrets
import time
from dataclasses import dataclass

import httpx
from fastapi import HTTPException, Request, Response

from app.config import get_settings

FLOW_COOKIE = "nfa_oauth"
FLOW_COOKIE_PATH = "/api/auth/oauth"
FLOW_SECONDS = 600
# Stored instead of a hash for accounts created through OAuth. Argon2 rejects it, so password login can never match.
UNUSABLE_PASSWORD = "!"

_discovery_cache: dict[str, dict] = {}


@dataclass
class Identity:
    issuer: str
    subject: str
    email: str


def enabled() -> bool:
    s = get_settings()
    return bool(s.oidc_issuer and s.oidc_client_id and s.oidc_client_secret)


def provider_name() -> str:
    return get_settings().oidc_provider_name


def redirect_url() -> str:
    s = get_settings()
    return s.oidc_redirect_url or f"{s.cors_origins[0].rstrip('/')}/auth/callback"


# A flow is single-use. Error responses do not carry cookies set on the injected Response, so they clear it themselves.
CLEAR_FLOW = {"Set-Cookie": f'{FLOW_COOKIE}=""; Max-Age=0; Path={FLOW_COOKIE_PATH}; HttpOnly; SameSite=lax'}


def _failed(why: str) -> HTTPException:
    return HTTPException(400, f"Sign-in with the provider failed: {why}", headers=CLEAR_FLOW)


def fetch_discovery() -> dict:
    """The provider's endpoints, from its discovery document (cached for the life of the process)."""
    issuer = get_settings().oidc_issuer.rstrip("/")
    if issuer not in _discovery_cache:
        try:
            r = httpx.get(f"{issuer}/.well-known/openid-configuration", timeout=10,
                          headers={"User-Agent": get_settings().http_user_agent})
            r.raise_for_status()
            doc = r.json()
        except (httpx.HTTPError, ValueError):
            raise HTTPException(503, "The sign-in provider is not reachable. Try again later.") from None
        if doc.get("issuer", "").rstrip("/") != issuer or not all(
                str(doc.get(k, "")).startswith("https://") or get_settings().environment != "production"
                for k in ("authorization_endpoint", "token_endpoint", "userinfo_endpoint")):
            raise HTTPException(503, "The sign-in provider is misconfigured.")
        _discovery_cache[issuer] = doc
    return _discovery_cache[issuer]


def exchange_code(code: str, verifier: str) -> dict:
    s = get_settings()
    try:
        r = httpx.post(fetch_discovery()["token_endpoint"], timeout=10, headers={"Accept": "application/json"},
                       data={"grant_type": "authorization_code", "code": code, "redirect_uri": redirect_url(),
                             "client_id": s.oidc_client_id, "client_secret": s.oidc_client_secret, "code_verifier": verifier})
        r.raise_for_status()
        return r.json()
    except (httpx.HTTPError, ValueError):
        raise _failed("the code was not accepted") from None


def fetch_userinfo(access_token: str) -> dict:
    try:
        r = httpx.get(fetch_discovery()["userinfo_endpoint"], timeout=10, headers={"Authorization": f"Bearer {access_token}"})
        r.raise_for_status()
        return r.json()
    except (httpx.HTTPError, ValueError):
        raise _failed("the account details could not be read") from None


def begin(response: Response, link: bool) -> str:
    """Start a flow: remember state, nonce and the PKCE verifier in a short-lived cookie; return the provider URL."""
    s = get_settings()
    state, nonce, verifier = (secrets.token_urlsafe(24) for _ in range(3))
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    response.set_cookie(FLOW_COOKIE, json.dumps({"s": state, "n": nonce, "v": verifier, "l": link}), max_age=FLOW_SECONDS,
                        httponly=True, secure=s.cookie_secure, samesite="lax", path=FLOW_COOKIE_PATH)
    params = {"response_type": "code", "client_id": s.oidc_client_id, "redirect_uri": redirect_url(), "scope": "openid email",
              "state": state, "nonce": nonce, "code_challenge": challenge, "code_challenge_method": "S256"}
    return str(httpx.URL(fetch_discovery()["authorization_endpoint"], params=params))


def _claims(id_token: str) -> dict:
    # The token came straight from the provider's token endpoint over TLS, so its signature is not re-checked
    # (OpenID Connect Core 3.1.3.7); issuer, audience, expiry and nonce are.
    try:
        payload = id_token.split(".")[1]
        return json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    except (IndexError, ValueError):
        raise _failed("the identity token was malformed") from None


def complete(request: Request, response: Response, code: str, state: str) -> tuple[Identity, bool]:
    """Finish a flow. Returns the verified identity and whether the flow was started to link an existing account."""
    s = get_settings()
    try:
        flow = json.loads(request.cookies.get(FLOW_COOKIE) or "")
        expected, nonce, verifier, link = flow["s"], flow["n"], flow["v"], bool(flow["l"])
    except (ValueError, KeyError, TypeError):
        raise _failed("the sign-in request expired. Start again") from None
    response.delete_cookie(FLOW_COOKIE, path=FLOW_COOKIE_PATH)
    if not secrets.compare_digest(str(expected), state):
        raise _failed("the response did not match the request")

    tokens = exchange_code(code, verifier)
    claims = _claims(tokens.get("id_token") or "")
    audience = claims.get("aud")
    issuer = s.oidc_issuer.rstrip("/")
    if (str(claims.get("iss", "")).rstrip("/") != issuer
            or s.oidc_client_id not in (audience if isinstance(audience, list) else [audience])
            or not isinstance(claims.get("exp"), int | float) or claims["exp"] < time.time()
            or not secrets.compare_digest(str(claims.get("nonce", "")), nonce)):
        raise _failed("the identity token was not valid")

    info = fetch_userinfo(tokens.get("access_token") or "")
    subject, email = info.get("sub"), info.get("email")
    if not subject or subject != claims.get("sub"):
        raise _failed("the account details did not match")
    if not email or info.get("email_verified") not in (True, "true"):
        raise _failed("the provider has not verified this email address")
    return Identity(issuer=issuer, subject=str(subject), email=str(email).lower()), link
