from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.public import load_location
from app.auth import oauth
from app.auth.security import (
    burn_verify,
    create_session,
    destroy_session,
    hash_password,
    login_limiter,
    optional_user,
    require_user,
    verify_password,
)
from app.db import get_db
from app.geospatial.search import public_visibility
from app.models import Location, OAuthIdentity, User, UserSession
from app.schemas import DeleteAccountIn, LoginIn, MeOut, OAuthCallbackIn, OAuthStartIn, PreferencesIn, RegisterIn, UserOut
from app.services.presenter import summary

router = APIRouter(prefix="/api", tags=["accounts"])


def user_out(u: User, db: Session) -> dict:
    linked = db.scalar(select(OAuthIdentity.id).where(OAuthIdentity.user_id == u.id).limit(1)) is not None
    return {"id": u.id, "email": u.email, "role": u.role, "preferred_language": u.preferred_language, "preferences": u.preferences or {},
            "has_password": u.password_hash != oauth.UNUSABLE_PASSWORD, "oauth_linked": linked}


@router.post("/auth/register", response_model=UserOut, status_code=201)
def register(body: RegisterIn, request: Request, response: Response, db: Session = Depends(get_db)):
    if not login_limiter.allow(f"register:{request.client.host if request.client else '-'}"):
        raise HTTPException(429, "Too many attempts. Please wait and try again.")
    user = User(email=body.email.lower(), password_hash=hash_password(body.password), preferred_language=body.preferred_language,
                preferences={})
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "An account with this email already exists") from None
    create_session(db, user, response)
    return user_out(user, db)


@router.post("/auth/login", response_model=UserOut)
def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    ip = request.client.host if request.client else "-"
    email = body.email.lower()
    if not (login_limiter.allow(f"ip:{ip}") and login_limiter.allow(f"email:{email}")):
        raise HTTPException(429, "Too many sign-in attempts. Please wait 15 minutes and try again.")
    user = db.scalar(select(User).where(User.email == email))
    if not user:
        burn_verify(body.password)
        raise HTTPException(401, "Email or password is incorrect")
    if not verify_password(user.password_hash, body.password):
        raise HTTPException(401, "Email or password is incorrect")
    create_session(db, user, response)
    return user_out(user, db)


@router.post("/auth/logout", status_code=204)
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    destroy_session(db, request, response)
    response.status_code = 204
    return response


@router.get("/auth/me", response_model=MeOut)
def me(user: User | None = Depends(optional_user), db: Session = Depends(get_db)):
    return {"user": user_out(user, db) if user else None}


@router.post("/auth/oauth/start")
def oauth_start(body: OAuthStartIn, request: Request, response: Response):
    """Begin sign-in with the configured OpenID Connect provider. The browser then goes to the returned URL."""
    if not oauth.enabled():
        raise HTTPException(404, "Sign-in with a provider is not enabled")
    if not login_limiter.allow(f"oauth-start:{request.client.host if request.client else '-'}"):
        raise HTTPException(429, "Too many attempts. Please wait and try again.")
    return {"url": oauth.begin(response, body.link)}


@router.post("/auth/oauth/callback", response_model=UserOut)
def oauth_callback(body: OAuthCallbackIn, request: Request, response: Response, db: Session = Depends(get_db)):
    if not oauth.enabled():
        raise HTTPException(404, "Sign-in with a provider is not enabled")
    if not login_limiter.allow(f"oauth-callback:{request.client.host if request.client else '-'}"):
        raise HTTPException(429, "Too many attempts. Please wait and try again.")
    ident, link = oauth.complete(request, response, body.code, body.state)
    known = db.scalar(select(OAuthIdentity).where(OAuthIdentity.issuer == ident.issuer, OAuthIdentity.subject == ident.subject))

    if link:  # connect the provider to the account that is signed in right now
        user = require_user(request, db)
        if known and known.user_id != user.id:
            raise HTTPException(409, "This provider account is already connected to a different account", headers=oauth.CLEAR_FLOW)
        if not known:
            db.add(OAuthIdentity(user_id=user.id, issuer=ident.issuer, subject=ident.subject))
            db.commit()
        return user_out(user, db)

    if known:
        user = db.get(User, known.user_id)
    else:
        if db.scalar(select(User.id).where(User.email == ident.email)):
            # Never adopt a password account by email match: local emails are unverified, so whoever registered it
            # first would keep access. The owner signs in with the password and connects the provider instead.
            raise HTTPException(409, "An account with this email already exists. Sign in with your password, then "
                                     "connect the provider from your account page.", headers=oauth.CLEAR_FLOW)
        user = User(email=ident.email, password_hash=oauth.UNUSABLE_PASSWORD, preferred_language=body.preferred_language,
                    preferences={})
        db.add(user)
        db.flush()
        db.add(OAuthIdentity(user_id=user.id, issuer=ident.issuer, subject=ident.subject))
        db.commit()
    create_session(db, user, response)
    return user_out(user, db)


def _current_location_id(db: Session, location_id: int) -> int:
    """Follow merges: a saved listing that was merged into another one now means the listing that was kept."""
    seen = set()
    while location_id not in seen:
        seen.add(location_id)
        target = db.scalar(select(Location.merged_into_id).where(Location.id == location_id))
        if not target:
            break
        location_id = target
    return location_id


@router.get("/me/favorites")
def list_favorites(user: User = Depends(require_user), db: Session = Depends(get_db)):
    ids = list(dict.fromkeys(_current_location_id(db, f["id"]) for f in reversed(user.saved_places)))  # newest first
    visible = set(db.scalars(select(Location.id).where(public_visibility(), Location.id.in_(ids))).all())
    items = []
    for location_id in ids:
        if location_id in visible:
            items.append({"id": location_id, "available": True, "resource": summary(load_location(db, location_id))})
        else:  # unpublished/closed since saving: keep the bookmark but expose nothing unpublished
            items.append({"id": location_id, "available": False, "resource": None})
    return {"items": items}


@router.post("/me/favorites/{location_id}", status_code=201)
def add_favorite(location_id: int, user: User = Depends(require_user), db: Session = Depends(get_db)):
    load_location(db, location_id)  # 404 unless publicly visible
    if all(_current_location_id(db, f["id"]) != location_id for f in user.saved_places):
        user.saved_places = [*user.saved_places, {"id": location_id, "at": datetime.now(UTC).isoformat(timespec="seconds")}]
        db.commit()
    return {"id": location_id, "saved": True}


@router.delete("/me/favorites/{location_id}", status_code=204)
def remove_favorite(location_id: int, user: User = Depends(require_user), db: Session = Depends(get_db)):
    kept = [f for f in user.saved_places if location_id not in (f["id"], _current_location_id(db, f["id"]))]
    if len(kept) != len(user.saved_places):
        user.saved_places = kept
        db.commit()
    return Response(status_code=204)


@router.patch("/me/preferences", response_model=UserOut)
def update_preferences(body: PreferencesIn, user: User = Depends(require_user), db: Session = Depends(get_db)):
    if body.preferred_language:
        user.preferred_language = body.preferred_language
    if body.preferences is not None:
        user.preferences = body.preferences
    db.commit()
    return user_out(user, db)


@router.delete("/me", status_code=204)
def delete_account(body: DeleteAccountIn, request: Request, response: Response, user: User = Depends(require_user),
                   db: Session = Depends(get_db)):
    # Accounts without a password (OAuth sign-in) confirm with the session and CSRF token alone.
    if user.password_hash != oauth.UNUSABLE_PASSWORD and not verify_password(user.password_hash, body.password):
        raise HTTPException(401, "Password is incorrect")
    if user.role == "admin":
        raise HTTPException(409, "Administrator accounts must be removed by another administrator via the CLI")
    destroy_session(db, request, response)
    db.execute(delete(UserSession).where(UserSession.user_id == user.id))
    db.delete(user)  # preferences and saved places are part of the row
    db.commit()
    response.status_code = 204
    return response
