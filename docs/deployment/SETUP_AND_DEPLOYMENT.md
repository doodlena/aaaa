# Installation, development, database, testing, and deployment

## Requirements

Python 3.11+, Node 20+ (tested with Node 26), and PostgreSQL 15+ with PostGIS 3. `NULLS NOT DISTINCT` requires
PG15+. Development used PostgreSQL 17 and PostGIS 3.6. Everything is free and open source.

## Local development (one command)

`npm start` from the repository root runs `scripts/dev.mjs` (Node standard library only, no extra packages). It:

1. creates `.venv` and installs the backend when `backend/pyproject.toml` changed, and runs `npm ci` in `frontend/`
   when the lockfile changed;
2. uses the database in `FOODACCESS_DATABASE_URL` (environment or `.env`, default `localhost:5433`) if something is
   listening there. Otherwise it starts a Docker container, `foodaccess-dev-db` (`postgis/postgis:17-3.5`, data in the
   `foodaccess-dev-pgdata` volume, published on `127.0.0.1` only), and writes `.env` from `.env.example` if there is none;
3. runs `foodaccess bootstrap`, then the API on :8000 and Vite on :5173, and opens the browser (`-- --no-open` skips that).

`npm run demo` also creates `demo-admin@example.org` with a new random password (printed each run), loads the
synthetic `[TEST]` fixtures, and sets `FOODACCESS_SHOW_SYNTHETIC=true` for that run only. `npm run foodaccess -- <command>`
runs the CLI against the same database, `npm run db:stop` stops the container, and `npm test` runs the launcher's
unit tests. The container's fixed credentials are for local development only; set `FOODACCESS_DEV_DB_IMAGE` to use
another PostGIS image. The backend test suite still expects `FOODACCESS_TEST_DATABASE_URL` (see Tests).

## Local development (manual, no Docker)

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
| `SECRET_KEY` | unset (dev: `data/secret.key`) | Encrypts search preferences, saved places and stored secrets. **Set in production**, keep it stable, back it up. |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | unset | Optional OAuth sign-in (see below). Off unless all three are set. |
| `OIDC_PROVIDER_NAME`, `OIDC_REDIRECT_URL` | empty, `<first CORS origin>/auth/callback` | Button label; redirect URL registered with the provider |
| `VITE_MAP_STYLE_URL` | OpenFreeMap Liberty | MapLibre style. Point to self-hosted tiles in production if desired. |

## Private account data

Each account's search preferences and saved places are encrypted before they reach the database
(`backend/app/services/secrets.py`, column type `EncryptedJSON`). A database dump, a backup or the table itself shows only
`{"_enc": "..."}`, and there is no table linking accounts to listings. Email addresses are not encrypted (sign-in looks
them up) and passwords are Argon2 hashes.

- The key is `FOODACCESS_SECRET_KEY` (any long random string; a Fernet key is used as is). Whoever has both the
  database and this key can read the data, so store the key only in the host's environment settings.
- If production runs without the key, accounts keep working but this data is stored in the clear and a warning is
  logged. `foodaccess bootstrap` (run on every start) encrypts such rows once the key is set.
- If the key is changed or lost, existing preferences and saved places can no longer be read: people stay signed up but
  see empty preferences and no saved places.

## OAuth sign-in (optional)

Sign-in with any OpenID Connect provider (Google, Microsoft, or a self-hosted one such as Keycloak or Authentik) is
built in and off by default. Password accounts keep working either way.

1. Create an OAuth client ("Web application") with the provider. Register the redirect URL
   `<site>/auth/callback` (`http://localhost:5173/auth/callback` for local development).
2. Set `FOODACCESS_OIDC_ISSUER` (e.g. `https://accounts.google.com`), `FOODACCESS_OIDC_CLIENT_ID`,
   `FOODACCESS_OIDC_CLIENT_SECRET` and, for the button label, `FOODACCESS_OIDC_PROVIDER_NAME` in `.env`. Never commit
   the secret.
3. Restart the API. `/api/meta/features` then reports `oauth.enabled: true` and the sign-in pages show the button.

Only the `openid email` scopes are requested and only the provider's subject id is stored (table `oauth_identities`).
The provider must report the email as verified. A provider sign-in never takes over an existing password account with
the same email: that person signs in with the password and uses "Connect" on the account page.

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

## Administrator account on Render + Vercel

Render's free plan has no shell, so `backend/render-start.sh` creates the administrator on start:

1. In the Render dashboard, open `lantern-api` → Environment and add `FOODACCESS_ADMIN_EMAIL` and
   `FOODACCESS_ADMIN_PASSWORD` (at least 12 characters; a shorter one stops the service from starting).
2. Save and let the service redeploy. The log prints `admin ready: <email>`.
3. Sign in on the Vercel site at `/login` with that email and password. Administrators land on `/admin/overview`.
4. Remove both variables afterwards. While they are set, every restart resets that account's password to the value.

## Production notes

- Hosting, bandwidth, backups (`pg_dump`), and maintenance still cost money and effort, even though no software
  licenses or paid APIs are required.
- Public OpenStreetMap/Nominatim services have usage policies. For real traffic, self-host Nominatim or rely on the
  Census geocoder plus the ZIP table, and use OpenFreeMap or self-hosted tiles.
- Login rate limiting is in-process. If you run more than one API worker, put a shared limiter (for example, at the
  reverse proxy) in front.
