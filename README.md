# Northern Virginia Food Access Platform

A free, public website for families in Northern Virginia to find nearby food assistance. You can search by address,
ZIP code, or device location. The map and list stay in sync. You can filter by food type, kind of help, schedule,
eligibility, and accessibility. Each listing shows its services, when food is actually distributed, and who qualifies.
The site works in English and Spanish, and accounts are optional.

**Accuracy over quantity.** Every listing goes through manual verification by a named reviewer before it is published.
Unknown information is always shown as unknown and never as "no requirement".

| | |
|---|---|
| Stack | Python 3.12 · FastAPI · SQLAlchemy 2 · Alembic · PostgreSQL 17 + PostGIS 3.6 · React 19 + TypeScript + Vite · MapLibre GL (OpenFreeMap tiles) · react-i18next · Argon2 · pytest · Vitest · Playwright · Docker Compose |
| Cost model | Only free and open-source software and free public services. No API keys, no paid services. |
| Pilot | Prince William County, City of Manassas, Fairfax County (+ City of Fairfax), [chosen from official data](reports/pilot_research/PILOT_SELECTION_REPORT.md) |

## Data status: read this first

| Kind | What it is | Public? |
|---|---|---|
| **Real imported records** | 113 candidate locations from 4 official or nonprofit feeds (Capital Area Food Bank, Fairfax County, Prince William County, City of Manassas), imported 2026-10-12 | **No.** None has been manually verified yet, so none is published. |
| **Synthetic fixtures** | 8 fictional `[TEST]` listings for tests and local demos | Only when `FOODACCESS_SHOW_SYNTHETIC=true`, always labelled. Blocked in production. |
| **Research data** | VDOE Title I and meal-eligibility files (2025-26), Census ACS 2020-24, TIGER boundaries, ZCTA centroids | Used for pilot selection and geocoding |

## Quick start (local)

```bash
python3 -m venv .venv && .venv/bin/pip install -e "backend[dev]"
cp .env.example .env                       # point FOODACCESS_DATABASE_URL at a PostGIS database
cd backend
../.venv/bin/foodaccess bootstrap
../.venv/bin/foodaccess create-admin --email you@example.org
../.venv/bin/foodaccess demo --reviewer-email you@example.org     # optional synthetic demo data
../.venv/bin/uvicorn app.main:app --port 8000
cd ../frontend && npm install && npm run dev                      # http://localhost:5173
```

The full guide (database setup, environment variables, cron, Docker Compose) is in
[docs/deployment/SETUP_AND_DEPLOYMENT.md](docs/deployment/SETUP_AND_DEPLOYMENT.md).

## Tests

```bash
cd backend && ../.venv/bin/pytest          # 76 tests: unit, PostGIS/database, pipeline, API, adapters, research, expansion
cd frontend && npm test                    # 43 Vitest + React Testing Library tests
cd frontend && npx playwright test         # 5 end-to-end scenarios (needs API on :8000 with demo data)
```

## Documentation

- [Architecture](docs/architecture/ARCHITECTURE.md) · [API](docs/architecture/API.md) · [Multilingual](docs/architecture/MULTILINGUAL.md) · [Frontend](frontend/README.md)
- [Ingestion framework](docs/data_sources/INGESTION_FRAMEWORK.md) · [Source registry](docs/data_sources/SOURCE_REGISTRY.md) · [Source research](docs/pilot_research/SOURCE_DISCOVERY.md)
- [Pilot methodology](docs/pilot_research/METHODOLOGY.md) · [Pilot selection report](reports/pilot_research/PILOT_SELECTION_REPORT.md) · [Pilot evaluation report](reports/pilot_evaluation/PILOT_EVALUATION_REPORT.md)
- [Verification guide](docs/verification/VERIFICATION_GUIDE.md) · [Expansion guide](docs/expansion/EXPANSION_GUIDE.md)
- [Project progress, limitations, next steps](PROJECT_PROGRESS.md)

## Disclaimer

Food assistance information changes often. Listings show when they were last verified. Always confirm hours and
requirements with the provider before you go. The platform does not collect income, immigration status, or other
sensitive information. It does not store device location, and it uses no analytics or advertising trackers.

Map data © OpenStreetMap contributors (ODbL). Tiles by OpenFreeMap. Source data © its respective owners, as
attributed on each listing.
