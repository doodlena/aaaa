# Open Shelf — frontend

**Open Shelf**: “What's on the shelf today, near you.” A live, two-way connection between food pantries and families:
pantries post today's status and items themselves; families see it (with the source and time) before they go.
Public site + pantry portal + admin review UI.

The brand name is **not hard-coded**: it comes from `GET /api/meta/features` → `app_name` (fallback `Open Shelf`,
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

E2E credentials can be overridden with `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD` and `E2E_PANTRY_EMAIL` /
`E2E_PANTRY_PASSWORD` (demo staff `pantry@localhost.test`). E2E scenarios only touch `[TEST]` listings: G re-posts
Maple's demo shelf (open; fresh vegetables plenty, eggs some, dairy low) and H's report is resolved in `afterAll`.
The backend rate-limits sign-ins and anonymous reports (5/hour per IP), so running the suite many times in a row can
fail with 429 — wait and re-run.

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

Open Shelf additions

```
src/components/  Brand (inline SVG shelf mark), Live (status glyph, level meter, shelf tags, "Posted by the pantry"),
                 TodayShelves (home feed), ReportDialog + Modal, VisitPlanner (checklist, .ics, print card, share),
                 AISearch, OfflineBanner
src/pages/pantry/ PantryRoutes (/pantry, lazy, sign-in required): PantryHome (request access, your pantries),
                 PantryDashboard (/pantry/:id: status + items, events, closures, corrections, reports, AI paste),
                 SurplusBoard (/pantry/surplus)
src/pages/admin/AdminClaimsReports.tsx  pantry access requests + community reports queues
src/lib/offline.ts + public/sw.js       PWA: service worker registration (production builds only) + cache warming
```

Visual identity (see `styles/app.css`, "Open Shelf additions")

- **Concept: the pantry shelf.** Live posts hang as yellow *shelf-talker tags* under a blueberry *shelf board*; the
  header is the top board. Everything else stays quiet.
- **Palette:** blueberry `#232a63` (brand/actions/boards), porcelain `#f4f5f9` (page), shelf-talker yellow `#ffd34d`
  (live posts only; never used as text colour), leaf `#1d6b45` (open), brick `#a3352b` (alerts/closed), slate
  `#586070` (unknown).
- **Type:** Big Shoulders Display (900/700, display: h1, feed and section titles), Atkinson Hyperlegible (body),
  Atkinson Hyperlegible Mono (times, "posted 2 h ago", levels). All self-hosted via `@fontsource`.
- **Status is shape + text:** open = filled circle ✓, limited = half circle, out = dashed empty circle, closed = square
  ✕; levels are 3/2/1 bars (decorative, `aria-hidden`) + the word Plenty/Some/Low. Map pins get a labelled badge
  ("✓ Open", "✕ Closed") under the existing numbered pin. Known = solid, unknown = dashed still applies everywhere
  (checklist "Ask the pantry — not confirmed" rows are dashed).

Key decisions

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
