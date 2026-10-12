# REST API

Interactive docs: `http://localhost:8000/api/docs`. Machine-readable spec: `docs/architecture/openapi.json`, regenerate
with `curl localhost:8000/api/openapi.json`. Responses are JSON. Errors look like `{"detail": "...", "errors"?: [...]}`
with standard status codes: 401 not signed in, 403 forbidden or CSRF failure, 404, 409 workflow conflict, 422
validation, 429 rate limited, 503 database unavailable. Validation errors never echo submitted values.

## Public (no account)

| Method & path | Purpose |
|---|---|
| `GET /api/resources/search` | `lat`,`lon`,`radius_km` (≤80) **or** `bbox=minLon,minLat,maxLon,maxLat`; `jurisdiction`; `food_group`, `food_type`, `service_group`, `service_type` (comma lists; every selected group must be offered); `eligibility` (`no_id_required`, `no_income_docs_required`, `no_proof_of_address_required`, `no_appointment_required`, `no_referral_required`, `no_residency_restriction`, `student_affiliation`); `date`, `open_today`, `upcoming_days`; `wheelchair`; `language`; `sort` (`distance`, `next_distribution`, `relevance`, `name`); `include_uncertain`; `page`, `page_size`. Returns `items` (confirmed matches), `uncertain` (matches except filters whose info is unknown, with `unconfirmed`), `coverage`, and pagination. |
| `GET /api/resources/{id}?lang=es` | Full detail: organization, services, eligibility details, distribution vs office schedules, next 14 days of windows, events, closures, sources, translations, directions links. `current_inventory` is always `null` until providers report stock. |
| `GET /api/events/upcoming` | Distribution windows (recurring and one-time) in the next N days near a point. |
| `GET /api/geocode?q=` | ZIP (offline Census ZCTA) → address (Census geocoder) → Nominatim. |
| `GET /api/meta/categories` | Food and service codes with filter groups, and eligibility filter keys. |
| `GET /api/jurisdictions` | Registry with status (pilot, expansion, planned) and published counts. |
| `GET /api/meta/verification` | Freshness threshold, source list with last success, demo mode flag. |
| `GET /api/health` | Liveness. |

Only listings that are published, verified or stale, not merged, not permanently closed, and have coordinates are
public. Synthetic listings are public only in demo mode, and always with `is_synthetic: true`.

## Accounts (cookie session `nfa_session` HttpOnly + `nfa_csrf`; send `X-CSRF-Token` on writes)

`POST /api/auth/register`, `POST /api/auth/login` (rate limited per IP and per email), `POST /api/auth/logout`,
`GET /api/auth/me` → `{user|null}`, `GET/POST/DELETE /api/me/favorites[/{id}]`, `PATCH /api/me/preferences`
(language plus an allow-listed set of non-sensitive search preferences), `DELETE /api/me` (password confirmation;
favorites are deleted with the account).

## Administrator (`role=admin`)

`GET /api/admin/queue`, `GET|PATCH /api/admin/resources/{id}`, `POST /api/admin/resources/{id}/actions`,
`GET /api/admin/changes`, `POST /api/admin/changes/{id}/decision`, `GET /api/admin/duplicates`,
`POST /api/admin/duplicates/{id}/decision`, `GET /api/admin/ingestion/runs`, `GET /api/admin/sources`,
`GET /api/admin/quality`, `GET /api/admin/organizations/{id}`.
