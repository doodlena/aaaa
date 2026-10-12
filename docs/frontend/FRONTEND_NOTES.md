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

## Open issues

1. ~~Backend blocked the dev admin login (`EmailStr` rejected `.test`).~~ **Fixed 2026-10-12**: login now takes a plain
   string (format is validated at registration). Playwright scenario D passes.
2. Machine-translation labels rely on `translations` keys `entity:id:field`; organization IDs are not in the public
   detail payload, so the organization description translation is matched by prefix.
