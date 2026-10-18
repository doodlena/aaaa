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

**Arlington County food resources (2026-10-12).** New source `arlington-food-resources` (adapter
`arlington_food_resources`, `rows_are_distinct: true` so programs sharing a venue go to duplicate review instead of
auto-merging). 69 rows imported as 68 unverified candidates; 11 same-venue duplicate flags decided in the dev database
(10 distinct, 1 merged). **None are verified.** The county file disagrees with AFAC's own page on hours at Arlington Mill
(9–11 vs 9:30–11:30 Mon) and Westover (3–5:30 vs 3:30–5 Wed); both sets are stored until a reviewer picks one.
`foodaccess verify-source --source … --reviewer-email … --method … --notes … [--publish]` records a named admin's
verification of a source's listings (same gates as the admin UI). Verification lives only in the database; snapshots
do not carry it. `data/snapshots/` has not been re-exported for this source.

**Admin overview (2026-10-12).** `/admin/overview` is the reviewers' landing page (administrators go there after
signing in unless a `?next` is set): counts of what is waiting (provider access requests, unverified listings, conflicts
and duplicates, open reports, overdue re-checks), totals, listings by review status, completeness bars, and verify/publish
actions per week for 8 weeks. Numbers come from `GET /api/admin/quality` and the new `GET /api/admin/overview`; synthetic
listings are left out and a metric the server cannot compute shows as "—". No visitor tracking was added. Tests:
`test_admin_overview_*`, `admin.test.tsx`, `auth.test.tsx`. Not yet deployed; the production admin account is created by
setting `FOODACCESS_ADMIN_EMAIL` and `FOODACCESS_ADMIN_PASSWORD` on Render (`backend/render-start.sh`).

**Unverified section (2026-10-12).** `/admin/unverified` lists every listing no reviewer has confirmed (`candidate` or
`needs_review`; `GET /api/admin/queue?unverified=true`, which now also returns phone and website) with a verify form on
each row: method required, optional "verify and publish" through the usual publish gates. There is deliberately no
"verify all": each verification is one named reviewer's check of one listing. Rows with pending source changes send the
reviewer to the full record. Tests: `test_admin_queue_unverified_*`, `admin.test.tsx`.

**Migration numbering fix (2026-10-12).** Two migrations were both revision `0010` (provider portal and account
encryption), so `alembic upgrade head` failed with "multiple heads" and Render could not start any build after the
provider-portal one. The encryption migration is now `0011` (revises `0010`). The local dev database, which had run it
under the old number, was given the two provider-portal columns and stamped `0011` by hand.

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
- UI languages: all five catalogs are bundled (2026-10-17; loading Chinese, Vietnamese and Korean on demand failed
  silently on the owner's devices while working in fresh browsers). Chinese (Simplified), Vietnamese and Korean sit
  behind the "+" button in the language switcher (`frontend/src/i18n/index.ts`). The three new catalogs were machine-written
  and have not been reviewed by native speakers. All five catalogs have identical keys, including the admin and
  pantry-portal screens (`language.test.tsx` enforces this). Right-to-left languages (Arabic, Urdu, Farsi) are not supported yet (layout uses physical left/right,
  and Arabic needs extra plural forms).
- "What do you need?" chips in the explorer are multi-select. Several needs are sent with `need_match=any`, so results
  are places that offer any of them (selected food groups together count as one need). The API default stays `all`.
- The congressional-district view was removed: no `area` search parameter, `/api/coverage-areas` endpoint or
  `coverage_areas` table (migration `0007`). Source ids, data files and research logs keep their `va08` names because
  imported records reference them. The default search radius is 10 miles (frontend and API).
- Site settings (2026-10-17): Admin → Site settings has three runtime switches stored in `app_settings`
  (`app/services/site_flags.py`, no migration). None of them deletes or changes listings.
  - **Only Virginia's 8th district** (on by default): the public site shows only listings inside VA-08 (Census TIGERweb
    boundary, `data/boundaries/va08_cd119_tigerweb.geojson`, `app/geospatial/district.py`). This narrows the five-locality
    pilot further: City of Fairfax and most of Fairfax County fall outside it.
  - **Live provider updates** (off by default): hides "Open today (provider-confirmed)", "On the shelf today", the home
    page live feed and "Today at this location" until providers are actually posting.
  - **Demo mode** (off by default): loads 21 fictional providers from `data/fixtures/demo_providers.json` on first use
    (`app/services/demo.py`), all inside VA-08 and verified, with today's posts, events, 3 access requests and 3 community
    reports. The public site shows the real listings plus the demo ones (only the 10 demo providers with posts have live
    updates); the admin dashboard shows only demo data. It forces live provider updates on and hides the
    "Test data" badge. There is no demo banner (removed at the owner's request for filming). Demo mode is per browser:
    the `lantern_demo` cookie set by Admin → Site settings, read per request (`site_flags.set_demo_mode` in
    `app/main.py`); those responses are `private, no-store`. Everyone else sees the normal site. Tests: `test_site_settings.py`,
    `siteSettings.test.tsx`.
  - On phones the admin menu is one horizontally swipeable row.
  - Search results list places with a live provider update today first, then in the chosen order.
- Owner curation (2026-10-17): `data/snapshots/curation.json` hides listings that are not free direct assistance (33
  for-profit treatment/therapy businesses from the SAMHSA directory; 10 apartment-complex distribution sites for their
  residents) and merges 30 duplicate listings. Keyed by stable source-record keys and replayed by `load-data` on every
  database (`cli._apply_curation`); hidden listings stay in Admin. The admin dashboard's "On Find help" total uses the
  same visibility rule as search, so it always matches what visitors see (real + demo in demo mode).
- "Who can get help here" (2026-10-17): every card and detail page lists documented limits on who is served
  (residents only, students or school families, age, income, ZIP/service area, referral; `presenter.who_for`), with the
  provider's own wording on the detail page. Only `required` limits are shown; unknown is never shown as open to all.
  Data quality pass (2026-10-17): 48 listings tagged from their own source text (curation.json "eligibility", with the
  quoted evidence): adults-only treatment programs (SAMHSA "Age Groups Accepted"), shelters' populations served
  (families with children, single adults, single men, survivors), women-only and men-only programs, WIC, paratransit
  (disability), income limits. New eligibility type `population` (migration 0014) with `values.groups` from
  `vocab.POPULATION_GROUPS`; cards show the group ("Women only", "Families with children"). Duplicate check over all
  269 public listings found one more (Neighborhood Health Arlington Pediatric Center at an old address; merged into the
  HRSA address, 3401 Columbia Pike Suite 200). School pantries have no documented limits and are left untagged.
- Stale pages after a deploy: lazily loaded files (Chinese/Vietnamese/Korean catalogs, explorer, admin) from an older
  version no longer exist. Missing /assets/ files now 404 instead of returning index.html (vercel.json), the service
  worker never caches HTML as an asset (cache version os-v3), and a failed load reloads once into the new version
  (`reloadForNewVersion`, at most once a minute).
- The staff portal is labelled "For services" and serves every kind of provider. `/api/provider/me` reports
  `offers_food` per listing; when false the portal hides the food-only controls ("Out of food", shelf items, event food
  offerings). The URL is still `/pantry`, and the surplus board remains food-only.
  Non-food-only listings (2026-10-12): "Today's status" reuses the live-status model (`shelf_updates`, no migration):
  open / limited / closed today + message, shown publicly like any live status. The API refuses food items, "out" and
  event food offerings for them (422). Events read "Special event or clinic day"; proposed hours are `operating_hours`.
  Providers can propose category changes (`add_service_types` / `remove_service_types`) → one `service_types`
  ChangeProposal (`{"add","remove"}`), applied as a delta only when an admin accepts it (`apply_service_type_delta`);
  admin review shows it as labelled lists. `offers_food` counts the `non_food` group (diapers, hygiene) as food-side,
  matching the frontend's FOOD_SERVICE_GROUPS. Tests: `test_non_food_*`, `test_category_change_*`, `nonFoodPortal.test.tsx`.
- Search preferences and saved places are encrypted at rest with `FOODACCESS_SECRET_KEY` (migration `0011`; the
  `favorites` table is gone, saved places live in `users.saved_places`). Emails and preferred language are not
  encrypted. Without the key in production the data is stored in the clear with a logged warning.
- Daily encrypted database backup to private Backblaze B2 storage (`.github/workflows/backup.yml`, restore with
  `scripts/restore-backup.sh`, guide in `docs/deployment/BACKUPS.md`). Dump, encryption and restore were rehearsed
  locally; the upload step has not run yet because it needs the repository secrets.
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
