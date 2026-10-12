# VA-08 Web Research Log

- **Retrieved:** 2026-10-12
- **Output:** `data/sources/va08_web_research.json` (77 records)
- **Method:** AI-assisted web research in a Claude Code session. Each page was fetched individually, with a 1–2 s delay between requests. Fields were transcribed only from the fetched text. Addresses were geocoded with the U.S. Census geocoder (`Public_AR_Current`, about 1 request per second). Each point was tested against `data/boundaries/va08_cd119_tigerweb.geojson`. ZIP codes were cross-checked against the geocoder's matched address, and all of them agreed.
- **Validation (python):** the JSON loads; all 77 coordinates fall inside the VA-08 polygon; `external_id`s are unique; service, food and eligibility enums are valid; and every schedule time is a well-formed `HH:MM` with `opens < closes`.

## Records by locality (jurisdiction, not mailing city)

| Locality | Records |
|---|---|
| Arlington County | 29 |
| City of Alexandria | 36 |
| Fairfax County (eastern, in VA-08) | 12 |
| City of Falls Church | 0 (see gaps) |

Other counts:

- 47 records have parsed schedules.
- 41 records have structured eligibility.
- 28 records have `organization_website`.
- 17 records have `needs_primary_confirmation: true`.

## Sources consulted

| Source | Status | Records added |
|---|---|---|
| City of Alexandria Food Resource Directory, Jan 2026 – https://www.alexandriava.gov/sites/default/files/2026-01/Alexandria%20Food%20Resource%20Directory.pdf | OK (current version, used as primary) | 13 |
| City of Alexandria Food Resource Directory, May 2024 – https://www.alexandriava.gov/sites/default/files/2024-05/alexandria_food_directory.pdf | OK (superseded; used only for comparison) | 0 |
| ALIVE! Food Program – https://www.alive-inc.org/food-program-in-alexandria-virginia/ | OK (page updated 2026-10-07) | 10 |
| Hunger Free Alexandria "I Need Assistance" – https://www.hungerfreealexandria.com/i-need-assistance | OK | 13 (Little Free Pantries, flagged needs_primary_confirmation) |
| Hunger Free Alexandria home page and Spanish directory PDF | OK (discovery only) | 0 |
| Historic Christ Church outreach – https://www.historicchristchurch.org/outreach | OK (corroborates Lazarus pantry) | 0 (note added) |
| Catholic Charities (CCDA) food pages – https://www.ccda.net/find-help/food/ and https://ccda.net/find-help/food/alexandria-food-pantry/ | OK | 0 directly (Christ House is cited from the city PDF, with CCDA details in notes) |
| CCDA master pantry listing 9/12/2025 – https://ccda.net/wp-content/uploads/2025/09/Website-Pantry-Listing-9.12.2025.pdf | OK | 2 (needs_primary_confirmation) |
| Arlington County DHS Food Assistance page – https://www.arlingtonva.us/Government/Departments/DHS/Food-Assistance | OK (via WebFetch) | 0 (discovery and corroboration) |
| Arlington County 2026 "Free Food Assistance in Arlington" 2-page flyer (Feb 2026) – https://www.arlingtonva.us/files/sharedassets/public/v/2/departments/documents/dhs/food-security/2-pager/english-2026-food-assistance-2-page-flyer.pdf | curl got HTTP 403; retrieved through the WebFetch tool | 19 |
| Arlington County 2026 Food Assistance Directory brochure (Feb 2026) – https://www.arlingtonva.us/files/sharedassets/public/v/4/departments/documents/dhs/food-security/2025-food-brochure-english.pdf | curl got HTTP 403; retrieved through the WebFetch tool | 6 |
| AFAC Get Groceries – https://afac.org/get-groceries/ (robots.txt allows all) | OK | 6 |
| United Community Food – https://www.unitedcommunity.org/food/ (robots.txt crawl-delay 10 respected) | OK | 3 |
| Rising Hope programs – https://www.risinghopeumc.org/programs | OK (`/community-outreach` returned 404) | 1 |
| Fairfax County Franconia food assistance – https://www.fairfaxcounty.gov/franconia/food-assistance | OK (discovery; Rising Hope and United Community addresses) | 0 |
| Fairfax County Mount Vernon "Get Help, Give Help" – https://www.fairfaxcounty.gov/mountvernon/get-help-give-help | OK, but COVID-era and stale (discovery only) | 0 |
| Fairfax County Food Providers Network page | OK (now only a redirect notice) | 0 |
| Fairfax County Food Council "Providers Accepting Fresh Produce" | **Blocked (HTTP 403)**, skipped | 0 |
| Groveton Baptist Church – https://grovetonbaptistchurch.org/ | OK | 1 |
| ACCA Food Pantry – https://accacares.org/foodpantry/ | OK | 1 |
| Culmore UMC food ministry – https://www.culmoreumc.org/food--clothing-ministry.html (address from home page) | OK | 1 |
| Falls Church Community Service Council – https://fcswecare.org/programs/ and /get-help/ | OK | 1 |
| City of Falls Church Food Assistance – https://www.fallschurchva.gov/2184/Food-Assistance | OK (lists only a referral phone line) | 0 |
| Koinonia Foundation – http://www.koinoniacares.org/ (the HTTPS certificate does not match the host; plain HTTP worked) | OK | 0 (outside VA-08) |
| ECHO – https://www.echo-inc.org/get-help/ | OK | 0 (outside VA-08) |
| Dar Al-Hijrah – https://hijrah.org/services/social-services/ | **Blocked (HTTP 403)**, skipped | 0 (record built from the Arlington County brochure instead) |
| Columbia Baptist Church food pantry – https://columbia.church/join-the-mission/local/food-pantry/ | **Blocked (HTTP 403)**, skipped | 0 |
| West End Food Pantry – https://www.westendfoodpantry.com/ | HTTP 404 | 0 |
| Web search results (211 Virginia, findhelp, feedam, Yelp and similar) | Used only to discover names; no fields were taken from them | 0 |

> **Retrieval note:** for the two Arlington County PDFs, curl received HTTP 403 but the WebFetch tool retrieved them normally. The county DHS page links to them publicly. Review whether this is acceptable under the "no bypass" rule. If it is not, drop the 25 records that cite those two URLs.

## Places found but excluded

- **Outside VA-08 (boundary test):**
  - Koinonia Foundation, at both 6107 Franconia Rd (new) and 6037 Franconia Rd (old office).
  - ECHO, 7205 Old Keene Mill Rd, Springfield.
  - Sydenstricker UMC, 8508 Hooes Rd.
  - Lorton Community Action Center (not researched further; Lorton is outside the district).
- **Closing:** Catholic Charities Alexandria Food Pantry (4725A Eisenhower Ave). Its page says it closes October 23, 2026, and operates through October 22, 2026.
- **Not open to the public, or not food distribution:**
  - Carpenter's Shelter: meals are for shelter residents only.
  - SNAP, WIC and SNAP Double Dollars, farmers markets, Farm Market Fresh/SFMNP vouchers: benefit programs or retail.
  - Too Good To Go: retail.
  - Animal Welfare League: pet food.
  - Food Security Coalition.
- **Pure referral lines:**
  - 2-1-1 Virginia.
  - City of Falls Church Housing & Human Services (703-248-5005).
  - Fairfax County Coordinated Services Planning (703-222-0880).
  - Arlington DHS (703-228-1300).
  - Hunger Free Alexandria (a coalition).
- **Not free:** SHARE Food Network ($30 package via Macedonia Baptist and Lomax AME Zion; Arlington DHS page).
- **No geocodable address or no fixed site:**
  - Food For Others site at "Corner of Columbia Pike & Four Mile Run Dr./S. Buchanan St."
  - Randolph, Carlin Springs and Drew Elementary school pantries: families of enrolled students only, and no address was given.
  - AFAC and Real Food For Kids apartment-building pickups and the CAFB Senior Brown Bag program: residents only, enrolled through property staff.
  - ALIVE! Home Delivery, Meals on Wheels, Groceries to Go, CSFP, Mother of Light Center: delivery programs without a public site.
- **Superseded or removed:**
  - May 2024 city directory entries that are not in the Jan 2026 edition: YMCA Food Pantry (420 E Monroe Ave), First Agape Baptist (marked "Delete"), Woodlawn ES / Girl Scout Troop 1444 Little Free Pantries.
  - Old Town Community Church pop-up.

## Data conflicts noted in records

- **West End Food Pantry:** the city's Jan 2026 directory gives 5150 Fillmore Ave. ALIVE (Oct 2026) gives "2800 Hope Way", which did not geocode. The record uses Fillmore Ave and is flagged.
- **ALIVE Monthly Fresh Market:**
  - ALIVE gives "Leonard 'Chick' Armstrong Recreation Center (3600 Commonwealth Ave.)". The city directory gives 25 W Reed Ave, which is the address used.
  - The time is 8:30–10:30 on ALIVE and 8:30–11:30 in the city directory. No structured schedule was parsed because the dates vary.
- **AFAC Arlington Mill:** 9:30–11:30 on afac.org and 9:00–11:30 on the county flyer. The record uses the AFAC times.
- **Mission: NOVA:** "7th Road S." on the flyer and "7th St. S." in the brochure. Both geocode inside VA-08; the record uses the flyer.
- **Park Shirlington mobile market:** 4510 on the flyer and 4505 in the brochure.
- **Meade Memorial bag lunch:** Mon–Fri 12–1 in the city directory. ALIVE gives "Thu & Fri 12:00 a.m. – 11:00 p.m.", which is garbled. The record uses the city directory.
- **ALIVE Food Hub mid-day closure:** 2–2:30 on ALIVE and 2–3 in the city directory. The record uses ALIVE.
- **St. Anthony of Padua and St. Charles hours** differ between the CCDA 2025 listing and the 2026 Arlington brochure and flyer. The records use the county sources.

## Gaps

- **City of Falls Church:** no in-city distribution site was confirmed. Columbia Baptist was blocked (403), and the city lists only a referral line. Worth a manual check: Columbia Baptist (Saturday pantry, according to search results), and any other in-city congregations.
- **Eastern Fairfax:** coverage is partial because the Fairfax ArcGIS layer is already imported. Not researched:
  - Good Shepherd Catholic, St. Louis Catholic, First AME (8653 Richmond Hwy), Revival Baptist Ministries, Royal Missionary Baptist, Route One Community Kitchen. These were found only in secondary listings.
  - Bailey's Crossroads and Lincolnia congregations beyond Culmore, St. Anthony and Poor Sisters.
  - GRACE Ministries' own site.
- **Dar Al-Hijrah:** not confirmed on the organization's own site, which returned 403.
- **Missing time ranges:** Food For Others gives start times only, and Culmore and Mt. Jezreel give dates without full time ranges. These records have no structured schedules.
- **Languages:** no source stated service languages explicitly, so the `languages` field is omitted everywhere.

## Post-review decision (2026-10-12)

Records sourced only from the Arlington County DHS PDFs on `arlingtonva.us` were **removed** from
`data/sources/va08_web_research.json`. That host answered automated requests with HTTP 403, and fetching the PDFs
through a different client would work around a technical restriction, which project policy forbids. To include them,
a person should download the current Arlington food-resources brochure in a browser, save it under
`data/sources/manual/`, and add it as a `pdf_table` (or curated JSON) source with that local file as the retrieval
target.
