# Data source registry

Research date: 2026-10-12. Full findings, including blocked or unavailable sources: `docs/pilot_research/SOURCE_DISCOVERY.md`
and `source_discovery.json`. Configs live in `config/sources/`.

## Integrated (pilot)

| Id | Owner | Format | Coverage | Publication | Status |
|---|---|---|---|---|---|
| `cafb-get-help` | Capital Area Food Bank | ArcGIS FeatureServer (GeoJSON) | DC/MD/NoVA partner sites; queried per pilot jurisdiction | **permission_required**: no license on the item. Attribute CAFB and get permission before republication. Raw records are not stored. | Imported 2026-10-12: 81 discovered, 80 in scope |
| `fairfax-food-access` | Fairfax County NCS | ArcGIS FeatureServer (Survey123 layer) | Fairfax County | **permission_required**: county disclaimer allows internal or personal use only. Read-only queries. Raw records not stored. | Imported 2026-10-12: 45 |
| `pwc-cmn-resources` | Prince William County | ArcGIS FeatureServer | PWC (+ Manassas area) | permitted_with_attribution: PWC disclaimer, no reuse restriction stated | Imported 2026-10-12: 16 discovered, 13 in scope |
| `manassas-food-resources` | City of Manassas | ArcGIS FeatureServer | Manassas area | permitted_with_attribution: "reference purposes only", no accuracy guarantee | Imported 2026-10-12: 18 (layer last edited 2024-08) |
| `synthetic-fixtures` | Project test suite | JSON | Fictional | **Synthetic. Never real.** | Tests and demo only |

The publication flag is enforced in code. A listing backed only by `permission_required` or `not_assessed` sources
can be published only after a reviewer verifies it **directly with the provider** (phone, email, in person, or provider
submission). The published facts are then the provider's own, not a copy of the restricted dataset.

## Researched, not integrated

| Source | Reason |
|---|---|
| Arlington Food Assistance Center HTML page (5 sites) | Arlington is not in the pilot. Small enough to curate by hand when Arlington is added. |
| Arlington County DHS brochure (PDF) | `arlingtonva.us` returned 403 to automated requests during research. |
| Alexandria Food Resource Directory (PDF, 2024) | Alexandria is not in the pilot. `pdf_table` adapter available. |
| Fairfax County food resources PDFs (2019/2023) | Stale; superseded by the FeatureServer. |
| PWC Food Distribution Sites (2022 layer) | Stale; useful only as a cross-check. |
| DC Open Data CAFB providers (2015, CC BY 4.0) | Historical only. |
| OpenStreetMap Overpass | Only 3 food banks are tagged in Northern Virginia. Adapter `osm_overpass` exists for later supplementary discovery (ODbL attribution required; respect Overpass usage policy). |

## Research datasets (pilot selection)

| Dataset | Official URL | Copy used | License |
|---|---|---|---|
| VDOE 2025-26 Title I schools (XLSX) | doe.virginia.gov/home/showpublisheddocument/64871/… | Internet Archive snapshot of the official URL (VDOE returned 403) | Public government data |
| VDOE NSLP free/reduced eligibility by school 2025-26 (XLSX) | doe.virginia.gov/home/showpublisheddocument/76094/… | Internet Archive snapshot | Public government data |
| Census ACS 2020-24 5-year summary file (B22003, C17002) | www2.census.gov/…/5YRData/ | Official | Public domain |
| Census TIGERweb county boundaries | tigerweb.geo.census.gov | Official | Public domain |
| Census 2024 Gazetteer ZCTA centroids | www2.census.gov/geo/docs/maps-data/data/gazetteer/ | Official | Public domain |

The SHA-256 of every downloaded file is recorded in `data/research/raw/manifest.json` (raw files are git-ignored and
re-downloadable). A small committed extract, `data/research/acs_2024_5yr_nova.json`, keeps the ACS step reproducible
offline.
