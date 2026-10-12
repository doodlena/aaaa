import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import OperationalError

from app.api import accounts, admin, public
from app.config import get_settings

log = logging.getLogger("api")


def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(
        title="Northern Virginia Food Access API",
        version="0.1.0",
        description="Public search for food assistance resources, optional accounts, and an administrator verification API.",
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=s.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["Content-Type", "X-CSRF-Token"],
    )

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault("Permissions-Policy", "geolocation=(self), camera=(), microphone=()")
        if request.url.path.startswith("/api/") and not request.url.path.startswith("/api/docs"):
            response.headers.setdefault("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
            response.headers.setdefault("Cache-Control", "no-store" if "/me" in request.url.path or "/admin" in request.url.path
                                        or "/auth" in request.url.path else "public, max-age=60")
        return response

    @app.exception_handler(RequestValidationError)
    async def validation_error(_request: Request, exc: RequestValidationError):
        errors = [{"loc": e.get("loc"), "msg": e.get("msg")} for e in exc.errors()]  # never echo submitted values (passwords)
        return JSONResponse(status_code=422, content={"detail": "Invalid request", "errors": errors})

    @app.exception_handler(OperationalError)
    async def db_down(_request: Request, exc: OperationalError):
        log.error("database unavailable: %s", type(exc).__name__)
        return JSONResponse(status_code=503, content={"detail": "Service temporarily unavailable"})

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    app.include_router(public.router)
    app.include_router(accounts.router)
    app.include_router(admin.router)
    return app


app = create_app()
