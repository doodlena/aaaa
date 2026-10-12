# Northern Virginia Food Access — frontend

Public site + admin review UI for the food-access platform. React 19 + TypeScript + Vite, react-router 7,
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

E2E admin credentials can be overridden with `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD`.

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
- **Adding a language:** copy `src/i18n/locales/en.json` to `<code>.json`, translate, register it in `src/i18n/index.ts`.
  A unit test fails if catalogs have different keys.
