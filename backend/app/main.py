import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import OperationalError

from app.api import accounts, admin, provider, public
from app.config import get_settings

log = logging.getLogger("api")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    from app.services import scheduler

    scheduler.start()  # daily automatic refresh (no-op in tests or when disabled)
    yield
    scheduler.stop()


def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(
        lifespan=lifespan,
        title=f"{s.app_name} API",
        version="0.1.0",
        description="Lantern: live food, mental-health and community support resources for Northern Virginia — public search, provider portal, community reports, and a verification API.",
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
            path = request.url.path
            private = any(x in path for x in ("/me", "/admin", "/auth", "/provider"))
            # Public data changes often (imports, live provider posts, reports): browsers must revalidate every time so
            # result counts and live statuses are never stale. Only the static category list may be reused briefly.
            response.headers.setdefault("Cache-Control", "no-store" if private
                                        else "public, max-age=300" if path == "/api/meta/categories" else "no-cache")
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
    app.include_router(provider.router)
    return app


app = create_app()
