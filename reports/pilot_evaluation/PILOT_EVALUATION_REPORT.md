# Pilot evaluation report

Generated 2026-10-12T15:33:42Z by `foodaccess evaluate-pilot`. All figures are computed from the database, ingestion run logs and test-result files at that moment; none are estimated.

**Verdict: NOT YET READY for expansion.** Software readiness and real-world data verification are reported separately below.

## Scope

- Pilot divisions (VDOE numbers): [75, 143, 29]
- Pilot jurisdictions: fairfax-city, fairfax-county, manassas-city, prince-william-county
- Selection: Top `pilot_size` divisions by score among those with ≥80% of factor weight available. (reports/pilot_research/PILOT_SELECTION_REPORT.md)

## Data status (real records only)

| Stage | Count |
|---|---:|
| Raw source records stored | 156 |
| Candidate locations (all review states) | 113 |
| Verified (incl. stale) by a named reviewer | 0 |
| Published | 0 |

By review status: `{"candidate": 113}`

Synthetic fixtures (separate, never counted above): 8 locations, 8 published in the local demo database only.

## Sources — researched 10, integrated 4

| Source | Runs | Succeeded | Failed | Discovered (first run) | Last run counts |
|---|---:|---:|---:|---:|---|
| cafb-get-help | 2 | 2 | 0 | 81 | `{"unchanged": 80, "discovered": 81, "needs_review": 113, "out_of_scope": 1}` |
| fairfax-food-access | 2 | 2 | 0 | 45 | `{"unchanged": 45, "discovered": 45, "needs_review": 113}` |
| manassas-food-resources | 2 | 2 | 0 | 18 | `{"unchanged": 18, "discovered": 18, "needs_review": 113}` |
| pwc-cmn-resources | 2 | 2 | 0 | 16 | `{"unchanged": 13, "discovered": 16, "needs_review": 113, "out_of_scope": 3}` |

## Field completeness by source (normalized records)

| Source | Records | Coordinates | Parsed schedule | Hours text only (unparsed) | Food types | Eligibility | Official website | Phone |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| cafb-get-help | 80 | 100.0% | 91.2% | 5.0% | 93.8% | 0.0% | 0.0% | 83.8% |
| fairfax-food-access | 45 | 100.0% | 75.6% | 24.4% | 97.8% | 100.0% | 93.3% | 100.0% |
| manassas-food-resources | 18 | 100.0% | 50.0% | 22.2% | 0.0% | 16.7% | 0.0% | 77.8% |
| pwc-cmn-resources | 13 | 100.0% | 61.5% | 38.5% | 53.8% | 100.0% | 92.3% | 100.0% |

## Quality metrics vs targets (all real candidate locations)

| Metric | Target | Actual | Met |
|---|---:|---:|:---:|
| valid_coordinates_pct | ≥95% | 100.0% | yes |
| valid_address_pct | ≥90% | 97.3% | yes |
| with_source_attribution_pct | ≥100% | 100.0% | yes |
| with_distribution_schedule_pct | ≥60% | 78.8% | yes |
| with_service_types_pct | ≥90% | 97.3% | yes |
| with_documented_eligibility_pct | ≥50% | 37.2% | no |
| with_official_website_pct | ≥50% | 32.7% | no |

- Stale listings: 0; pending conflicting source changes: 0; locations with conflicting values across sources: 17; pending duplicate reviews: 27.
- Published listings without a verification record: 0; without source attribution: 0.

## Per jurisdiction

| Jurisdiction | Locations | Verified share ≥ 25%? | Coordinates | Schedule | Eligibility | Website |
|---|---:|:---:|---:|---:|---:|---:|
| fairfax-city | 0 | no | — | — | — | — |
| fairfax-county | 65 | no | 100.0% | 86.2% | 44.6% | 43.1% |
| manassas-city | 13 | no | 100.0% | 76.9% | 15.4% | 7.7% |
| prince-william-county | 35 | no | 100.0% | 65.7% | 31.4% | 22.9% |

## Geographic checks

- Real locations checked: 113; jurisdiction mismatches after point-in-polygon recheck: 0.
- Max relative difference PostGIS geodesic vs haversine: 0.0024 (PostGIS uses the WGS84 spheroid; haversine a sphere — differences up to ~0.5% are expected.)

## Acceptance criteria (automated test evidence)

| Criterion | Result | Tests |
|---|:---:|---|
| All published verified listings have an attributable manual verification record | pass | test_verification_requires_method_and_records_reviewer, test_admin_review_approve_publish |
| All public listings have source attribution | pass | test_admin_review_approve_publish |
| Unknown requirements are not interpreted as unrestricted | pass | test_no_id_filter_excludes_unknown_and_required, test_detail_has_structured_sections_and_unknowns |
| Imported records do not automatically overwrite verified fields | pass | test_changes_to_verified_record_become_proposals_not_overwrites |
| Re-running an unchanged import does not create duplicates | pass | test_reimport_is_idempotent |
| Nearby searches use correct spatial calculations | pass | test_radius_search_distance_order_and_postgis_distance, test_border_search_crosses_jurisdictions, test_viewport_search |
| Filters correctly handle unknown and missing information | pass | test_no_id_filter_excludes_unknown_and_required, test_date_filter_uses_distribution_schedule |
| Guest search works without authentication | pass | test_radius_search_distance_order_and_postgis_distance |
| Registered favorites persist | pass | test_favorites_flow_requires_csrf |
| Administrator endpoints are protected | pass | test_admin_routes_protected |
| Synthetic test records cannot be mistaken for published real resources | pass | test_unpublished_detail_404_and_synthetic_hidden_when_disabled, test_import_creates_unpublished_candidates_with_provenance |
| Map and list results remain synchronized | pass | list ↔ map synchronisation > list "Show on map" selects with origin=list and the map pans to it, list ↔ map synchronisation > marker click selects with origin=map, highlights the card and scrolls it into view |
| English and Spanish interface translations function | pass | language switching > switches UI text to Spanish and remembers the choice, language switching > has complete, matching English and Spanish catalogs |
| Restricted-license sources are not republished without direct provider verification | pass | test_restricted_source_needs_direct_verification_to_publish |

Evidence: reports/test-results/backend-junit.xml (pytest) and frontend-junit.xml (Vitest). Playwright scenarios A–D and F are run separately against live dev servers (see PROJECT_PROGRESS.md).

## Remaining manual verification work

- 113 candidate and 0 needs-review real listings await a reviewer.
- 27 duplicate candidates and 0 conflicting changes await decisions.
- CAFB and Fairfax County data may only be published after direct provider verification or written permission from the data owner.
- Expansion requires ≥25% of real candidates in each pilot jurisdiction to be manually verified (representative audit sample).
