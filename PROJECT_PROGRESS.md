# Project progress

_Last updated: 2026-10-12._ This file lets another agent or developer resume work without reconstructing past
decisions. Software completion and real-world data verification are tracked **separately**.

## Software status

### Complete and tested

| Area | Evidence |
|---|---|
| PostGIS schema (27 tables) and Alembic migration `0001`; upgrade, downgrade, and `alembic check` are clean | Every test session re-migrates from scratch |
| Jurisdiction registry (9 NoVA localities, many-to-many school divisions), TIGER boundaries, `config/pilot.yaml` scope | `test_new_jurisdiction_added_by_configuration_only`, `test_pilot_config_changes_scope_without_code` |
| Title I + meal-eligibility + ACS research script; configurable pilot scoring with sensitivity analysis | `test_title_i_*`, `test_pilot_scoring_*`; real run in `reports/pilot_research/` |
| Ingestion framework: polite fetcher (robots.txt, rate limits, cache, offline), adapter registry, generic adapters (JSON, CSV, ArcGIS, Overpass, PDF), 3 source-specific ArcGIS normalizers, validation, dedupe, staging, change proposals, field provenance, run reports | `tests/test_ingestion.py`, `tests/test_adapters.py`; 4 live pilot sources imported |
| Verification workflow (verify/publish/reject/flag/close/reopen/edit/merge), audit log, freshness and staleness, publication-rights gate | `test_verification_*`, `test_admin_*`, `test_restricted_source_needs_direct_verification_to_publish` |
| Public API: radius, viewport, and jurisdiction search; food/service/schedule/eligibility/accessibility filters with an "uncertain" tier; sorting; pagination; detail; events; geocoding; metadata | `tests/test_api.py` |
| Accounts: Argon2id, HttpOnly session cookie, CSRF, rate limiting, favorites, preferences (allow-listed), account deletion | `tests/test_api.py` |
| Optional OAuth sign-in (generic OpenID Connect: code flow with PKCE, state, nonce; account linking; off unless configured). Not yet tried against a real provider | `tests/test_oauth.py` (fake provider), `frontend/src/__tests__/oauth.test.tsx` |
| Frontend: home, explorer (MapLibre with clustering, synced list, filters, mobile toggle), detail, auth, account, favorites, about, full admin dashboard, EN/ES | 43 Vitest tests; Playwright A, B, C, D, F |
| Quality report, pilot evaluation report, CLI (`foodaccess …`), cron example | `reports/quality`, `reports/pilot_evaluation` |
| Optional machine-translation pipeline (LibreTranslate/Argos, self-hosted) | `test_translation_pipeline_and_fallback` (fake engine; no real engine was run) |

### Test results (executed 2026-10-12)

- Backend `pytest`: **76 passed, 0 failed** (PostgreSQL 17.x + PostGIS 3.6 on :5433).
- Frontend `vitest run`: **43 passed, 0 failed** (10 files). `tsc --noEmit` clean. `npm run build` clean.
- Playwright (Chromium) against live dev servers: **5 passed** (A, B, C, D, F). Scenario E (repeated ingestion) is
  backend-level: `test_reimport_is_idempotent`, `test_changes_to_verified_record_become_proposals_not_overwrites`, and
  a live offline re-run of all 4 pilot sources that inserted 0 records.
- Pilot evaluation acceptance criteria: 14/14 pass on automated evidence.

### Written but not executed

- `docker-compose.yml`, `backend/Dockerfile`, `frontend/Dockerfile`, and `frontend/nginx.conf`. Docker is not installed
  in the development environment.
- A real LibreTranslate/Argos engine (only the fake-engine test ran).

## Real-world data status

| Stage | Count |
|---|---:|
| Source records (real) | 156 |
| Candidate locations (real) | 113 (Fairfax County 65, Prince William 35, Manassas 13) |
| Manually verified | **0** |
| Published | **0** |
| Pending duplicate reviews | 27 |

**The pilot is not yet validated for expansion.** At least 25% of real candidates in each pilot jurisdiction must be
manually verified first (`foodaccess evaluate-pilot` checks this). Also: CAFB and Fairfax County data require written
permission or direct provider verification before publication. Eligibility documentation (37%) and official websites
(33%) are below their targets.

## Architectural decisions (see docs/architecture/ARCHITECTURE.md)

1. Modular monolith: FastAPI, PostGIS, React SPA, and a cron-driven CLI. No brokers.
2. Tri-state eligibility. Unknown filter matches go to a separate `uncertain` list.
3. Distribution schedules are separate from operating hours. The recurrence engine supports weekly, nth or last
   weekday, seasonal rules, exceptions, and events.
4. Imports never publish or overwrite verified data (change proposals). A record that disappears from a source flags
   the listing for review; it never closes it.
5. Publication rights are enforced per source (`publication`). Direct provider verification also permits publication.
6. Pilot = PWC, Manassas City, Fairfax County (+ City of Fairfax), selected by a transparent score. The same top three
   rank first under equal weights.
7. VDOE files came from Internet Archive copies of the official URLs because VDOE returned HTTP 403 to automated
   requests. Checksums are in `data/research/raw/manifest.json` (git-ignored).
8. Census API data now requires a key, so ACS values come from the keyless ACS summary files.
9. Map: MapLibre with an OpenFreeMap style (configurable). Geocoding: Census ZCTA table, then Census geocoder, then
   Nominatim (optional, 1 request/s).

## Known limitations

- Free-text hours parsing is conservative. 5–38% of records per source keep hours only as raw text for reviewers.
- CAFB has no website field and no eligibility fields. `ResidentsOnly=False` is not treated as "no residency
  requirement", because the default value is ambiguous.
- Login rate limiting is in-process (single worker).
- Search evaluates schedules and eligibility in Python on at most 1,000 spatial candidates. This is ample for the
  region, and documented.
- Loudoun, Falls Church, Arlington, Alexandria, and Manassas Park have no ingestion yet (planned status). Food-source
  research for Loudoun and Falls Church has not been done.
- OpenStreetMap coverage of NoVA pantries is very sparse (3 features). The adapter exists but is not enabled.
- UI languages: English and Spanish are bundled; Chinese (Simplified), Vietnamese and Korean sit behind the "+" button
  in the language switcher and load on demand (`frontend/src/i18n/index.ts`). The three new catalogs were machine-written
  and have not been reviewed by native speakers. All five catalogs have identical keys, including the admin and
  pantry-portal screens (`language.test.tsx` enforces this). Right-to-left languages (Arabic, Urdu, Farsi) are not supported yet (layout uses physical left/right,
  and Arabic needs extra plural forms).
- "What do you need?" chips in the explorer are multi-select. Several needs are sent with `need_match=any`, so results
  are places that offer any of them (selected food groups together count as one need). The API default stays `all`.
- No automated accessibility audit (axe) has been run. WCAG practices were applied and checked by hand.
- Development environment notes: the Homebrew `node` 26.5 binary is broken (missing `libsimdjson`), so `/usr/local/bin`
  node 22 was used, with `npm_config_cache` pointed at a writable directory.

## Developer tooling

- **Graphify** 0.9.87 was installed in an isolated virtualenv (`uv` is unavailable). Code graphs were built locally
  without an LLM via `graphify update backend` and `graphify update frontend/src` (git-ignored `graphify-out/`).
  `graphify install --project` was **not** run: this version has no `--project` flag, and `install` writes to the
  user-level assistant config.
- **Ponytail** was **not installed**. Its install path is the Claude Code `/plugin marketplace add` and `/plugin
  install` slash commands, which only the user can run interactively. Its principles (stdlib first, minimal
  dependencies, no needless abstraction) were followed manually.

## How to resume

`npm start` at the repository root does all of the following in one step (`scripts/dev.mjs`: venv, `npm ci`, a Docker
PostGIS container when no database is listening, `bootstrap`, API + Vite). Executed 2026-10-12 on Linux with Node 24,
Python 3.14, and Docker 29: clean first run, `npm run demo` (8 synthetic listings visible), relaunch, and Ctrl+C
shutdown. **Not executed on macOS or Windows.** 6 `node --test` unit tests pass (`npm test`). The manual equivalent:

```bash
/opt/homebrew/opt/postgresql@17/bin/pg_ctl -D /opt/homebrew/var/postgresql@17 -o "-p 5433" start
cd backend && ../.venv/bin/uvicorn app.main:app --port 8000 --reload
cd frontend && PATH=/usr/local/bin:$PATH npm run dev
cd backend && ../.venv/bin/pytest && ../.venv/bin/foodaccess evaluate-pilot
```

## Next steps

1. Reviewers verify a stratified 25%+ sample per pilot jurisdiction. Contact CAFB and Fairfax County for
   republication permission.
2. Resolve the 27 duplicate candidates. Add official websites and eligibility during verification.
3. Run `docker compose up` on a server, put TLS in front, set `COOKIE_SECURE=true` and a contact `HTTP_USER_AGENT`.
4. Add an axe accessibility check to Playwright. Get a native-speaker review of the Spanish, Chinese, Vietnamese and Korean catalogs.
5. Expansion: Alexandria (add CAFB `where_by_jurisdiction`), then Arlington (curate AFAC sites), then the others.
