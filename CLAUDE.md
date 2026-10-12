# CLAUDE.md / AGENTS.md — working notes for coding agents

Start with `PROJECT_PROGRESS.md` (status, decisions, how to resume). Architecture is in `docs/architecture/ARCHITECTURE.md`.

## Commands

- Everything at once: `npm start` at the repo root (`scripts/dev.mjs`; `npm run demo` adds synthetic data; `npm test` tests the launcher).
- Postgres + PostGIS for development: port **5433**, databases `foodaccess` (dev) and `foodaccess_test` (pytest drops and re-migrates it).
- Backend: `cd backend && ../.venv/bin/pytest`, `../.venv/bin/uvicorn app.main:app --port 8000 --reload`, `../.venv/bin/foodaccess --help`
- Frontend: `cd frontend && npm test`, `npm run build`, `npx playwright test` (needs the API on :8000 with `foodaccess demo` data)
- Code graph (Graphify): `graphify update backend` / `graphify update frontend/src`, then read `*/graphify-out/GRAPH_REPORT.md`
  or run `graphify explain "<symbol>"` before broad file searches. The graph is derived, not ground truth.

## Rules that must not regress

- Never fabricate data: pantry records, URLs, schedules, eligibility, Title I numbers, verification timestamps, metrics.
- Eligibility is tri-state. "Unknown" must never satisfy a "not required" filter or be displayed as unrestricted.
- Imports never publish and never overwrite verified values. Conflicts become `ChangeProposal`s.
- Publishing requires an attributable `verify` action, coordinates, a source record, and publication rights (see `workflow.publication_allowed`).
- Synthetic fixtures (`is_synthetic`, names prefixed `[TEST]`) stay separate from real data. They cannot be published in production.
- Free and open-source services only. No paid APIs. Respect robots.txt, terms, and rate limits. Never bypass access controls.
- Never use any tool or skill named "DataViz".
- Add a test with every behavior change. Tests must not depend on live websites.

## Conventions

- Shared vocabularies live in `backend/app/vocab.py`. UI labels live in `frontend/src/i18n/locales/{en,es}.json`, keyed by those codes.
- New sources are YAML in `config/sources/`, plus an adapter only when the generic ones don't fit (`docs/data_sources/INGESTION_FRAMEWORK.md`).
- New jurisdictions are configuration only (`docs/expansion/EXPANSION_GUIDE.md`).
- Update `PROJECT_PROGRESS.md` after each milestone.
