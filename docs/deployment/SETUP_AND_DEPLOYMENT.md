# Installation, development, database, testing, and deployment

## Requirements

Python 3.11+, Node 20+ (tested with Node 26), and PostgreSQL 15+ with PostGIS 3. `NULLS NOT DISTINCT` requires
PG15+. Development used PostgreSQL 17 and PostGIS 3.6. Everything is free and open source.

## Local development (no Docker)

```bash
# Database (macOS/Homebrew example; any PostGIS works)
brew install postgresql@17 postgis
/opt/homebrew/opt/postgresql@17/bin/pg_ctl -D /opt/homebrew/var/postgresql@17 -o "-p 5433" start
createdb -p 5433 foodaccess && createdb -p 5433 foodaccess_test

# Backend
python3 -m venv .venv && .venv/bin/pip install -e "backend[dev]"
cp .env.example .env             # adjust FOODACCESS_DATABASE_URL
cd backend
../.venv/bin/foodaccess bootstrap                         # migrations + jurisdiction/source registries (idempotent)
../.venv/bin/foodaccess create-admin --email you@example.org
../.venv/bin/uvicorn app.main:app --port 8000 --reload    # API docs at http://localhost:8000/api/docs

# Optional local demo data (fictional, labelled [TEST]; requires FOODACCESS_SHOW_SYNTHETIC=true to be visible)
../.venv/bin/foodaccess demo --reviewer-email you@example.org

# Real pilot data (unverified candidates, visible only in the admin queue until verified and published)
../.venv/bin/foodaccess ingest

# Frontend
cd ../frontend && npm install && npm run dev               # http://localhost:5173 (proxies /api to :8000)
```

## Environment variables

See `.env.example`. Every backend variable uses the prefix `FOODACCESS_`.

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgresql+psycopg://localhost:5433/foodaccess` | SQLAlchemy URL |
| `ENVIRONMENT` | `development` | `production` blocks publishing synthetic records and the `demo` command |
| `SHOW_SYNTHETIC` | `false` | Shows synthetic fixtures publicly, always labelled. Keep false in production. |
| `CORS_ORIGINS` | `["http://localhost:5173"]` | Allowed browser origins (credentials enabled) |
| `COOKIE_SECURE` | `false` | Set true behind HTTPS |
| `SESSION_DAYS`, `LOGIN_ATTEMPTS_PER_15MIN` | 14, 10 | Session lifetime, login rate limit |
| `VERIFICATION_FRESH_DAYS` | 90 | Freshness threshold |
| `GEOCODERS` | `["zip","census","nominatim"]` | Provider chain |
| `NOMINATIM_URL` | public OSM instance | Self-host for production traffic (the public instance allows at most 1 request/s) |
| `HTTP_USER_AGENT` | project UA | Identifies the crawler. Include a contact address. |
| `TRANSLATION_PROVIDER`, `LIBRETRANSLATE_URL` | `none` | Optional machine translation |
| `MAX_SEARCH_RADIUS_KM` | 80 | API guard |
| `VITE_MAP_STYLE_URL` | OpenFreeMap Liberty | MapLibre style. Point to self-hosted tiles in production if desired. |

## Tests

```bash
cd backend && ../.venv/bin/pytest            # uses FOODACCESS_TEST_DATABASE_URL (default …:5433/foodaccess_test); drops & re-migrates it
cd frontend && npm test                      # Vitest + React Testing Library
cd frontend && npx playwright test           # E2E; requires the API on :8000 with demo data loaded
```

Backend tests use synthetic fixtures and small recorded samples of the source feeds. They never contact live websites.

## Scheduled jobs (cron)

`scripts/cron.example` lists the jobs: weekly `ingest`, daily `mark-stale`, weekly `quality-report` and `dedupe`.
Every command is idempotent, and a failing source never stops the others.

## Docker Compose (production-style)

```bash
cp .env.example .env    # set POSTGRES_PASSWORD, FOODACCESS_CORS_ORIGINS, FOODACCESS_COOKIE_SECURE=true
docker compose up -d --build
docker compose exec api foodaccess create-admin --email you@example.org
docker compose exec api foodaccess ingest
# optional self-hosted translation: docker compose --profile translate up -d
```

Services: `db` (postgis/postgis), `api` (FastAPI; runs `bootstrap` on start), `web` (nginx serving the built SPA and
proxying `/api`). Put a TLS-terminating reverse proxy in front.

**Status:** the Compose files were written but **not executed** in the development environment, because Docker was
not installed. Treat them as untested until the first `docker compose up`.

## Production notes

- Hosting, bandwidth, backups (`pg_dump`), and maintenance still cost money and effort, even though no software
  licenses or paid APIs are required.
- Public OpenStreetMap/Nominatim services have usage policies. For real traffic, self-host Nominatim or rely on the
  Census geocoder plus the ZIP table, and use OpenFreeMap or self-hosted tiles.
- Login rate limiting is in-process. If you run more than one API worker, put a shared limiter (for example, at the
  reverse proxy) in front.
