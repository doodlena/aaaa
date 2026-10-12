# Ingestion framework

`Discover → Retrieve → Parse → Normalize → Validate → Deduplicate → Stage → (manual) Review → Publish`

| Step | Code | Notes |
|---|---|---|
| Discover | `Adapter.discover()` | Defaults to `request_urls`/`url`. Scoped ArcGIS adapters build one query per **in-scope** jurisdiction (`options.where_by_jurisdiction`), so the pilot never requests the whole region. |
| Retrieve | `ingestion/base.py: Fetcher` | Honors robots.txt (`respect_robots`), spaces requests per host (`min_seconds_between_requests`), and keeps an on-disk cache (`cache_ttl_hours`, `data/cache/http`). `--offline` uses the cache only. Supports `file://` repo files and test fixtures. Never bypasses auth or CAPTCHAs, and identifies itself with `FOODACCESS_HTTP_USER_AGENT`. |
| Parse | `Adapter.parse()` → `RawRecord(external_id, data, source_url)` | Errors are recorded per URL. One bad file never stops other URLs or sources. |
| Normalize | `Adapter.normalize()` → `CandidateResource` | Pydantic-validated shape (`ingestion/candidate.py`). Only explicitly stated facts are mapped. Free text goes through conservative parsers (`normalization/text.py`); unparseable hours are kept verbatim in `raw_hours_text`. |
| Validate | `pipeline.validate` + `Adapter.validate` | Errors (record rejected → `invalid`): no name, no address or coordinates, coordinates outside the region. Warnings: missing ZIP, invalid phone, no schedule, no structured services, undocumented eligibility, unknown website. |
| Deduplicate | `deduplication/matcher.py` | Same-source records use the stable external id. Cross-source records are candidates within 500 m, at the same normalized address, or with the same name; they are scored and routed. |
| Stage | `pipeline.stage` | Unchanged hash → `unchanged`. New with no match → new `candidate` location. Ambiguous → `DuplicateCandidate` (pending). Linked unverified → refreshed in place, with services merged across all linked records. Linked verified → `ChangeProposal`s. |
| Review / Publish | Admin UI/API | See `docs/verification/VERIFICATION_GUIDE.md`. |

Each run writes `reports/ingestion/run-NNNNN-<source>.json` (machine-readable: counts, errors, records needing review)
and a `.md` summary. The counts are: discovered, inserted, updated, unchanged, rejected, duplicate_candidates,
conflicts, out_of_scope, gone, fetch_errors, parse_errors, and auto_linked.

## Adding a source

1. Research the source: URL, owner, format, robots.txt, terms, fields. Record your findings in
   `docs/data_sources/SOURCE_REGISTRY.md`.
2. Create `config/sources/<id>.yaml` with these fields: `id`, `name`, `owner`, `url` (human page, used for attribution),
   `adapter`, `jurisdictions`, `formats`, `request_urls` or `options.query_url`, `min_seconds_between_requests`,
   `cache_ttl_hours`, `store_raw` (false when terms don't allow retaining copies), `publication`
   (`permitted_with_attribution` | `permission_required` | `not_assessed`), `field_mappings`, `expected_fields`,
   `known_limitations`, `terms_notes`, `refresh` (cron), and `verified_on`.
3. If a generic adapter fits (`structured_json`, `csv_table`, `arcgis_feature_layer`, `pdf_table`, `osm_overpass`),
   you're done: map fields in `field_mappings`. Otherwise add a module in `backend/app/ingestion/adapters/`, subclass
   `Adapter`, decorate it with `@register("<name>")`, and import it in `adapters/__init__.py`.
4. Save a small sample response and add a parser test (see `tests/test_adapters.py`). Tests never hit live sites.
5. Run `foodaccess sync-registry`, then `foodaccess ingest --source <id>`, and read the run report.

## Free-text parsing rules (deliberately conservative)

- Schedules: only phrases with explicit days and a time range whose meridiem is known ("Tue 10am-12pm", "2nd and 4th
  Saturday 9-11am", "Monday 9-11:30 a.m. and 1-3 p.m."). Lines about enrollment, office, thrift, clothing, donations,
  or closures are ignored. Anything else stays as text for the reviewer.
- Food types and services: keyword matches only. The absence of a keyword never means the item is unavailable.
- Eligibility: `required` or `not_required` only on explicit wording. Negations win ("No ID required"). Everything else
  stays `unknown`. When sources disagree for the same site, the conservative reading wins (`required` >
  `not_required` > `unknown`), and the disagreement stays visible in the source records.
