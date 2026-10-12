# Lantern — frontend

**Lantern**: “Help that lights the way — food, health and support near you.” A guide to free help in Northern Virginia
(food pantries and meals, benefits, health, mental health, housing, money, clothing, legal, jobs/English classes, family,
transportation), with live updates posted by the providers themselves. Public site + provider portal + admin review UI.

The brand name is **not hard-coded**: it comes from `GET /api/meta/features` → `app_name` (fallback `Lantern`,
`src/state/meta.tsx`) and is used for the header, footer, document titles and copy (`{{app}}` in the catalogs).
`index.html` and `public/manifest.webmanifest` carry the static fallback name. React 19 + TypeScript + Vite, react-router 7,
react-i18next (English/Spanish), MapLibre GL JS. Plain CSS with variables (no CSS framework). All data comes from the
FastAPI backend — there is no mock data in the app.

## Requirements

- Node ≥ 20 (tested with Node 22.14). Backend running on `http://localhost:8000` (see `../backend`).
- Machine note: on the dev Mac the Homebrew `node` (26.x) is currently broken (missing `libsimdjson.33.dylib`), so use
  `/usr/local/bin/node`: `export PATH=/usr/local/bin:$PATH`. If `npm install` hits `EACCES` in `~/.npm`, set
  `npm_config_cache` to a writable directory.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server on **:5173**, proxying `/api` → `http://localhost:8000` (same-origin cookies) |
| `npm run build` | `tsc --noEmit` + production build into `dist/` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest + React Testing Library (jsdom, fetch mocked; maplibre mocked) |
| `npx playwright test` | E2E against the **real** backend; starts/reuses Vite on :5173. First run: `npx playwright install chromium` |

E2E suites:

| File | Data | Writes? |
| --- | --- | --- |
| `e2e/real-data.spec.ts` (R1–R4) | real imported listings | **read-only** — never signs in, posts, reports or saves |
| `public.spec.ts` B | real or demo | read-only |
| `public.spec.ts` A, F · `account.spec.ts` C · `admin.spec.ts` D · `live-updates.spec.ts` G, H, I | fictional `[TEST]` data | only `[TEST]` listings (+ a throwaway e2e user in C) |

Synthetic scenarios check `GET /api/meta/features` → `demo_mode` and **skip themselves** with a clear message when it is
false. To run them, start an API with `FOODACCESS_SHOW_SYNTHETIC=true` (e.g. a second one on :8001 behind
`VITE_DEV_PROXY_TARGET=http://localhost:8001 npx vite --port 5174`, then `E2E_BASE_URL=http://localhost:5174 npx
playwright test`). `e2e/global-setup.ts` signs in **once per account per run** and saves the sessions to `e2e/.auth/`
(git-ignored); scenarios reuse them (the API allows 10 sign-ins per 15 min per IP). Credentials: `E2E_ADMIN_EMAIL` /
`E2E_ADMIN_PASSWORD`, `E2E_PANTRY_EMAIL` / `E2E_PANTRY_PASSWORD` (demo staff `pantry@localhost.test`). G re-posts
Maple's demo shelf and H's report is resolved in `afterAll`. Anonymous reports are limited to 5/hour per IP.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_MAP_STYLE_URL` | `https://tiles.openfreemap.org/styles/liberty` | MapLibre style URL (free, no key). If it fails to load the map falls back to a raster OpenStreetMap style (`src/lib/mapStyle.ts`). |
| `VITE_API_BASE` | `/api` | API base. Keep same-origin in production (reverse proxy) so the session + CSRF cookies work. |
| `VITE_DEV_PROXY_TARGET` | `http://localhost:8000` | Dev only: where Vite proxies `/api`. |

See `.env.example`.

## Architecture

```
src/
  api/          client.ts (fetch wrapper: credentials, X-CSRF-Token from the nfa_csrf cookie, ApiError → i18n key), types.ts
  i18n/         index.ts + locales/{en,es}.json — keyed by backend vocab codes (foodType.*, serviceGroup.*, requirement.*, …)
  state/        auth.tsx (session, login/register/logout, language sync), meta.tsx (/meta/verification: demo banner, fresh_days),
                selection.ts (tiny external store shared by map + list)
  lib/          filters.ts (Filters ⇄ URL ⇄ API query), format.ts, mapStyle.ts (provider abstraction), useAsync, useMediaQuery
  components/   Layout, SearchForm, FiltersPanel, ResultsList/ResultCard, MapView (lazy), MiniMap (lazy), ResourceDetail, Badges…
  pages/        Home, Explorer (/find, lazy), Resource, Auth, Account, Favorites, About, admin/* (lazy)
  styles/app.css   design tokens + components
e2e/            Playwright scenarios (public, account, admin)
```

Live updates + Lantern additions

```
src/components/  Brand (inline SVG lantern mark), NeedsChooser ("What do you need?"), CrisisCallout (988/911), Live (status glyph, level meter, shelf tags, "Posted by the pantry"),
                 TodayShelves (home feed), ReportDialog + Modal, VisitPlanner (checklist, .ics, print card, share),
                 AISearch, OfflineBanner
src/pages/pantry/ PantryRoutes (/pantry, lazy, sign-in required): PantryHome (request access, your pantries),
                 PantryDashboard (/pantry/:id: status + items, events, closures, corrections, reports, AI paste),
                 SurplusBoard (/pantry/surplus)
src/pages/admin/AdminClaimsReports.tsx  pantry access requests + community reports queues
src/pages/admin/AdminAI.tsx  /admin/ai: Anthropic key (write-only), enable switch, model, test, remove
src/lib/needs.ts  need → filter mapping for the chooser (one filter per need; the search API ANDs groups)
src/lib/offline.ts + public/sw.js       PWA: service worker registration (production builds only) + cache warming
```

Visual identity (see the top of `styles/app.css`)

- **Concept: a lantern at night.** Night-blue chrome; warm amber light only where help is "lit": the lantern mark,
  the soft light pool under the "What do you need?" tiles (tiles glow amber on hover/focus), live updates from
  providers, active nav, focus rings on dark grounds. No large decorative art: the brand appears as the small mark in
  the header/footer and favicon; the home page leads with the needs chooser and search.
- **Palette:** night `#14203f` (brand/actions/header, 15.6:1 on white), night-deep `#0b142b`, glow amber `#f5b23c`
  (fills only — 8.4:1 *on night*, never text on light grounds), glow-soft `#fdeac2`, ember `#8a4600` (amber text on
  light, 7.1:1), mist page `#f1f3f8`; leaf `#1d6b45` (open), brick `#a3352b` (alerts/closed), slate `#586070`
  (unknown). Old token names (`--berry`, `--talker`) are aliases.
- **Type:** Young Serif (display: h1, section titles, brand), Atkinson Hyperlegible (body), Atkinson Hyperlegible Mono
  (times, levels). Self-hosted via `@fontsource`.
- **Status is shape + text:** verified = solid badge ✓; needs re-check = dashed ⏱; *from a public list — not yet
  verified* = dotted badge with a list icon (map pin `mk--reported` dotted); live status glyphs as before. AI settings
  status: Active = solid pill ✓, Off = square ✕, No key = dashed "?".
- **Crisis safety:** a 988/911 callout (tel:988, sms:988, tel:911; no close button) shows when Mental health is the
  selected need, when any result offers a mental-health service type, and on such a listing's page; the footer always
  carries "In crisis? Call 988 · Text 988 · Emergency: 911".

Key decisions

- **"What do you need?"** 13 tiles (home: links; explorer: single-select chips). Each maps to ONE filter
  (`food_group=groceries`, or one `service_group`) because the search API ANDs service groups; combinations go through
  the filter panel ("Places must offer every kind of help you check"). Baby & family supplies = `non_food` only (ANDing
  `food_group=infant` would hide diaper banks without formula). Food filters (type of food, "on the shelf today") are
  hidden — and cleared — when every selected need is non-food.
- **Area view:** `/find?area=va-08&bbox=-77.24,38.6,-77.03,38.97&sort=name` (from `GET /api/coverage-areas`, the
  explorer's "Area" select, or the home link). The list stays paginated (25); the map fetches every listing in the area
  (pages of 100, up to 500) so all pins show.
- **AI settings (/admin/ai):** the key is write-only (password input, autocomplete off, cleared after sending; only the
  server's `…WXYZ` hint is shown). Removing it uses an in-page confirmation (no `window.confirm`). Every change re-fetches
  `/api/meta/features` (`useMeta().refreshFeatures`) so AI search / drafts / suggestions appear without a reload.
- **Unknown is never "no requirement".** Eligibility is tri-state everywhere. Visual rule: *known is solid, unknown is
  dashed* — solid chip/marker = confirmed, dashed outline + "?" = not confirmed. Status is always icon/shape + text,
  never colour alone (map pins carry the list number or "?").
- **Uncertain results** from the API (`uncertain[]`, with `unconfirmed[]`) are rendered in a separate section,
  "May match — information not confirmed", listing exactly what is unconfirmed.
- **URL is the explorer's state** (`/find?lat&lon&radius_km&food_group=…`), so searches are shareable and back/forward
  works. `lib/filters.ts` is the single place that builds the API query.
- **Map ↔ list sync** goes through `state/selection.ts` (`origin` = who selected, so only the other view reacts). Clusters
  use MapLibre's GeoJSON clustering; markers are HTML elements so they don't depend on the style's glyph server. The
  list is the keyboard / screen-reader alternative to the map.
- **Lazy loading:** maplibre (~1 MB) and the admin UI are separate chunks.
- **Privacy:** no analytics, no third-party fonts (Atkinson Hyperlegible is self-hosted via `@fontsource`), geolocation
  only on explicit click and never stored.
- **Admin** is guarded client-side for UX; the server enforces 401/403 on every `/api/admin` call. Verify requires a
  method; reject / close permanently / unpublish ask for confirmation. Data quality is a plain table (no charts).
- **Live data is labelled and never invented.** Live items appear only from `live` (pantry posts, which expire);
  without a post the detail page says current stock is not confirmed. The visit checklist maps unknown → "Ask the
  pantry — not confirmed", never "Not needed".
- **Pantry portal:** status/events/closures publish immediately (server rule); corrections are proposals for review.
  AI drafts only prefill a form (highlighted "Drafted by AI — check every field", `things_to_check` listed) and set
  `ai_assisted=true`; nothing is sent until the person presses the post button.
- **AI features are hidden** unless `/api/meta/features` turns them on (`ai.search`, `ai.announcement_drafts`,
  `ai.structure_suggestions`). They are off in dev; unit tests cover both states with mocks.
- **PWA/offline:** `public/manifest.webmanifest` + hand-written `public/sw.js`. Navigations network-first with cached
  `index.html` fallback; hashed assets cache-first; API caching is limited to `GET /api/resources/<id>` and
  `/visit-plan` (visited pages, and saved places pre-warmed from the favorites page). `/api/admin`, `/api/provider`,
  `/api/auth`, `/api/me` and all non-GETs are never cached. The worker is registered only in production builds.
- **Print:** "Print visit card" prints only `.print-card` (name, address, phone, next times, checklist).
- **Adding a language:** copy `src/i18n/locales/en.json` to `<code>.json`, translate, register it in `src/i18n/index.ts`.
  A unit test fails if catalogs have different keys.
