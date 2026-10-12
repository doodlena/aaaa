# Regional expansion guide

All of Northern Virginia shares one codebase, one database, and one schema. Adding a jurisdiction is a configuration
change plus, when needed, a new source adapter. You never reinitialize the database, and verified listings are never
touched. This is tested in `backend/tests/test_research_and_expansion.py::test_new_jurisdiction_added_by_configuration_only`.

## Steps

1. **Registry.** Add or edit `config/jurisdictions/<id>.yaml` (`id`, `name`, `kind`, `county_fips`,
   `boundary.geoid`, `school_divisions`, `center`, `refresh`). All nine NoVA localities are already registered as
   `planned`.
2. **Boundaries.** If the locality is new, add its FIPS and run `foodaccess import-reference`. This downloads Census
   TIGERweb boundaries and ZCTA centroids for every registered county or city FIPS. For a town or a custom service
   area, drop a GeoJSON with a `GEOID` property into `data/boundaries/` and reference it with `boundary.geoid`.
3. **Activate.** Set `status: expansion` in the jurisdiction YAML, or add the id to `pilot_jurisdictions` in
   `config/pilot.yaml`. Then run `foodaccess sync-registry`.
4. **Sources.** Add the jurisdiction id to the `jurisdictions` list of existing sources (for example, add
   `arlington-county` and `alexandria-city` to CAFB's `where_by_jurisdiction`), or add new source YAMLs or adapters
   (see `docs/data_sources/INGESTION_FRAMEWORK.md`).
5. **Ingest.** Run `foodaccess ingest --jurisdiction <id>`, then `foodaccess dedupe`.
6. **Review.** Work through the admin queue for that jurisdiction (verify, then publish).
7. **Quality.** Run `foodaccess quality-report --jurisdiction <id>` and `foodaccess evaluate-pilot`.
8. **Publish.** Approved listings appear immediately, and the public coverage notice updates automatically from the
   active boundaries.

## Suggested order after the pilot

Based on the pilot selection ranking (`reports/pilot_research/PILOT_SELECTION_REPORT.md`):
Alexandria (CAFB: 14 sites), then Manassas Park (no structured source found yet, so manual curation is needed), then
Arlington (CAFB and AFAC), then Loudoun and Falls Church (source research still needed).
