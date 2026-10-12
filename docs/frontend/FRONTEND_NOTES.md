# Frontend notes

Developer documentation lives in `frontend/README.md`. This file records status and open issues.

## Status (2026-10-12)

- Public site: home/search (geocode, geolocation, jurisdiction browse), explorer (/find: map + list, filters, sort,
  radius circle, clustering, "Search this area", uncertain section, coverage notice, mobile list/map toggle + filter
  drawer), resource detail (page and explorer panel), auth, account (language, saved preferences, delete), favorites,
  about (sources from /api/meta/verification, demo banner).
- Admin: queue (status filters with counts, search, published/stale filters), review (actions, source records raw vs
  normalized, validation, provenance, change proposals, duplicates, history, audit, mini-map, edit form with
  services/schedules/eligibility editors), conflicts, ingestion runs, sources, data quality table.
- Tests: Vitest (unit/component) and Playwright (e2e against the real backend).

### Open Shelf rebrand + live features (2026-10-12)

- Renamed to **Open Shelf** (name from `/api/meta/features` → `app_name`; fallback "Open Shelf"). New identity:
  blueberry/porcelain/shelf-talker-yellow palette, Big Shoulders Display + Atkinson Hyperlegible (+ Mono), inline SVG
  shelf mark, favicon + maskable icon, manifest.
- Home leads with "Today's shelves near you" (live pantry posts; region-wide, or within 10 mi after "Show pantries
  near me"), then search, legend and a "For pantries" call to action.
- Live status everywhere: result cards, map pins (labelled badge per status), detail "Today at this pantry",
  "Open today (pantry-confirmed)" and "On the shelf today" filters (`live_open`, `live_food_group`), new match reasons
  and warnings, "N recent reports — being checked".
- Detail: "Report a problem" dialog (anonymous, 429 handled), visit planner (checklist, next times, .ics link, print
  card, share/copy link).
- Pantry portal `/pantry`: request access (find listing by address/ZIP), dashboard (status, items + levels, message,
  expiry, preview, clear, history), pop-up events, closures, corrections (hours + tri-state requirement editors),
  reports inbox, surplus board, AI "Paste your announcement" (feature-flagged).
- Admin: pantry access queue (listing phone + "call to confirm" guidance), community reports queue, proposal origin
  badges (import / from the pantry / AI-suggested), "Get AI suggestions" (feature-flagged), open reports in the queue.
- AI search box on home + explorer (feature-flagged; privacy line).
- PWA: manifest + small service worker (production builds only), offline banner.
- Tests: Vitest 65 (was 43); Playwright 8 (A–D, F + new G, H, I), all against the real dev API.

## Open issues

1. ~~Backend blocked the dev admin login (`EmailStr` rejected `.test`).~~ **Fixed 2026-10-12**: login now takes a plain
   string (format is validated at registration). Playwright scenario D passes.
2. Machine-translation labels rely on `translations` keys `entity:id:field`; organization IDs are not in the public
   detail payload, so the organization description translation is matched by prefix.
3. There is no public "live feed" endpoint; the home feed uses `/api/resources/search` (page_size 100) and keeps
   items with `live`. Fine at demo scale; a dedicated endpoint would be better with many pantries.
4. The request-access search reuses geocode + radius search (the search API has no name query), then filters by name
   client-side.
5. Service worker: verified manually on `vite preview` (production build) with Playwright — a visited pantry page
   reloads offline with its visit checklist and the offline banner. There is no automated offline test in the suite.
6. Backend rate limits (sign-in, 5 reports/hour/IP) can make back-to-back Playwright runs fail with 429.
7. Map pin live badges only show on unclustered points; clusters show a count.
