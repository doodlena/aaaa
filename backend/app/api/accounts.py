from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.public import load_location
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
from app.models import Favorite, Location, User, UserSession
from app.schemas import DeleteAccountIn, LoginIn, MeOut, PreferencesIn, RegisterIn, UserOut
from app.services.presenter import summary

router = APIRouter(prefix="/api", tags=["accounts"])


def user_out(u: User) -> dict:
    return {"id": u.id, "email": u.email, "role": u.role, "preferred_language": u.preferred_language, "preferences": u.preferences or {}}


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
    return user_out(user)


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
    return user_out(user)


@router.post("/auth/logout", status_code=204)
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    destroy_session(db, request, response)
    response.status_code = 204
    return response


@router.get("/auth/me", response_model=MeOut)
def me(user: User | None = Depends(optional_user)):
    return {"user": user_out(user) if user else None}


@router.get("/me/favorites")
def list_favorites(user: User = Depends(require_user), db: Session = Depends(get_db)):
    favs = db.scalars(select(Favorite).where(Favorite.user_id == user.id).order_by(Favorite.created_at.desc())).all()
    visible = set(db.scalars(select(Location.id).where(public_visibility(), Location.id.in_([f.location_id for f in favs]))).all())
    items = []
    for f in favs:
        if f.location_id in visible:
            items.append({"id": f.location_id, "available": True, "resource": summary(load_location(db, f.location_id))})
        else:  # unpublished/closed since saving: keep the bookmark but expose nothing unpublished
            items.append({"id": f.location_id, "available": False, "resource": None})
    return {"items": items}


@router.post("/me/favorites/{location_id}", status_code=201)
def add_favorite(location_id: int, user: User = Depends(require_user), db: Session = Depends(get_db)):
    load_location(db, location_id)  # 404 unless publicly visible
    if not db.get(Favorite, (user.id, location_id)):
        db.add(Favorite(user_id=user.id, location_id=location_id))
        db.commit()
    return {"id": location_id, "saved": True}


@router.delete("/me/favorites/{location_id}", status_code=204)
def remove_favorite(location_id: int, user: User = Depends(require_user), db: Session = Depends(get_db)):
    db.execute(delete(Favorite).where(Favorite.user_id == user.id, Favorite.location_id == location_id))
    db.commit()
    return Response(status_code=204)


@router.patch("/me/preferences", response_model=UserOut)
def update_preferences(body: PreferencesIn, user: User = Depends(require_user), db: Session = Depends(get_db)):
    if body.preferred_language:
        user.preferred_language = body.preferred_language
    if body.preferences is not None:
        user.preferences = body.preferences
    db.commit()
    return user_out(user)


@router.delete("/me", status_code=204)
def delete_account(body: DeleteAccountIn, request: Request, response: Response, user: User = Depends(require_user),
                   db: Session = Depends(get_db)):
    if not verify_password(user.password_hash, body.password):
        raise HTTPException(401, "Password is incorrect")
    if user.role == "admin":
        raise HTTPException(409, "Administrator accounts must be removed by another administrator via the CLI")
    destroy_session(db, request, response)
    db.execute(delete(UserSession).where(UserSession.user_id == user.id))
    db.delete(user)  # favorites cascade
    db.commit()
    response.status_code = 204
    return response
