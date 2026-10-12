# Northern Virginia (outside VA-08) Food Research Log

- **Retrieved:** 2026-10-12
- **Output:** `data/sources/nova_food_research.json` (33 records; new file, not an extension of an earlier one)
- **Scope:** food assistance in Loudoun, Prince William, Manassas, Manassas Park, western and central Fairfax County, and the City of Fairfax. The search concentrated on gaps not covered by imported feeds (CAFB, the Fairfax County food layer, PWC CMN and the Manassas layer).
- **Method:**
  - Each page was fetched with a client that checks robots.txt first. The client used the UA `LanternResearchBot/0.1` and paused at least 1.1 s between requests to the same host.
  - Web search was used only to find pages. Every field was transcribed from a page fetched in this session. `raw_hours_text` and `raw_eligibility_text` are verbatim excerpts, with `...` marking cuts.
  - Geocoding used the U.S. Census geocoder (`Public_AR_Current`).
  - Every point was tested with shapely against `data/boundaries/va08_cd119_tigerweb.geojson` (points inside were excluded) and against `nova_localities_tigerweb.geojson` (points outside NoVA were excluded).
- **Rules applied:**
  - Schedules were parsed only when a page gave an explicit day, start time and end time (weekday 0 = Monday). Distributions that list only a start time ("until supplies last") have raw text but no schedule.
  - Eligibility is recorded only where the page states it explicitly.
  - Hosts that blocked access were not retried with any other tool or client.
- **Validation:** the JSON is valid and was written after every batch of 5 or fewer records. Service, food and eligibility codes were checked against `backend/app/vocab.py`. `external_id`s are unique, and every schedule has `opens < closes`.

## Records by locality (from the point-in-polygon test)

| Locality | Records |
|---|---|
| Loudoun County | 13 (plus Dulles South Food Pantry, which has no coordinates) |
| Fairfax County (outside VA-08) | 11 |
| Prince William County | 8 |
| City of Manassas / Manassas Park / City of Fairfax | 0 (see gaps) |

- 14 records have structured schedules.
- 27 have structured eligibility.
- 15 are flagged `needs_primary_confirmation`.
- 26 have an `organization_website`.

## Excluded after geocoding

- FFO Annandale (Fairmont Gardens) and FFO Hollywood (Falls Church) fell inside VA-08.
- The Tree of Life dinner in Upperville is in Fauquier County, outside the NoVA locality polygons.
- FFO Seven Corners/Ellison sites and the Crevenna Oak site were not added because the page gives no street address that could be geocoded, or they are in VA-08.

## Sources

| Source | Status | Records |
|---|---|---|
| https://www.wfcmva.org/get-help (+ /contact-us) | OK | 2. The contact page shows two conflicting hour blocks, so schedules were not parsed and the records are flagged. |
| https://findfreedomtoday.org/ | OK | 1. Every other Monday; no times given. The address geocodes to Prince William County, not the City of Manassas Park. |
| https://dsfp.org/get-assistance, /service-area | OK | 1. The Census geocoder found no match, so the record has no coordinates. |
| https://www.tolministries.org/food-pantry/, /branches/food/ | OK | 5 (2 pantries with home delivery, 3 community dinners) |
| https://www.loudounfeeds.org/get-help | OK | 1 (Loudoun Hunger Relief emergency hours). Also used for discovery. |
| https://www.sevenloavesmiddleburg.org/regular-distrubution/ | OK | 1 |
| https://www.linkagainsthunger.org/get-help, /what-we-do | OK | 3 |
| https://www.roundhillumc.org/food-pantry | OK | 1 |
| https://lortonaction.org/food-pantry/ | OK | 1 |
| https://haymarketfoodpantry.org/find-help/ | OK | 1 |
| https://njlclovettsville.org/food-pantry | OK | 1 (Western Loudoun Food Pantry) |
| https://foodforothers.org/get-help/, /get-help/neighborhood-sites/ | OK | 5 (warehouse + 4 neighborhood sites outside VA-08) |
| https://www.poweredbyspark.org/programs/other_pwc_food_resources | OK ("up to date as of November 2025") | 6 PWC pantries not found in the imported-feed cache. All are flagged `needs_primary_confirmation`. |
| https://www.cornerstonesva.org/get-help | OK (the /services/... food page returned 404) | 1 |
| https://www.stjamesleesburg.org/grace-to-go | OK | 1 |
| https://ccda.net/find-help/food/sterling-food-pantry/ | OK | 1 |
| https://www.sterlingumc.org/grace | OK | 1 (flagged: the distribution location is not explicit) |
| https://www.herndonrestonfish.org/our-services | OK | 0. Food help is a grocery-card pilot in 2 schools, with no site. |
| https://mobile-hope.org/, https://mfhva.org/, https://anna-sudha.org/ | OK | 0. No client-facing food schedule or location was stated. |

## Blocked / not retrieved (not retried with any other client)

| Host / URL | Result |
|---|---|
| https://loudounhunger.org/ | robots.txt returned HTTP 403. The LHR record is sourced from Loudoun Feeds instead. |
| https://actspwc.org/food-assistance/ | robots.txt returned HTTP 403. ACTS is not added. |
| https://nvfs.org/our-places/hunger-resource-center/ | robots.txt returned HTTP 403. NVFS SERVE is not added. |
| https://www.manassasparkva.gov/Social%20Services/Food%20Bank%20Resources.pdf | robots.txt is `Disallow: /` for generic agents. Not fetched. |

## Gaps / follow-up for a human

- **ACTS (Dumfries), NVFS SERVE Hunger Resource Center (Manassas), and LHR's own site:** a person should check these in a browser or by phone.
- **City of Manassas Park:** no record falls inside the city polygon. Candidates to confirm by phone are Mision Cristiana Agape (8025 Rugby Rd) and the city's "Family Market" at Manassas Park High School, which appears only in the blocked city PDF.
- **City of Fairfax and City of Manassas:** no new gap records. These areas appear to be covered by imported feeds.
- **Loudoun providers listed on Loudoun Feeds whose own pages were not fetched:** Unison Church, Hands of Compassion, Sterling Park Baptist, America's Soup Kitchen, BetterALife, Manna From Heaven (its site gives no client schedule), and Mobile Hope (youth only).
- **Dulles South Food Pantry:** needs a manual geocode.
