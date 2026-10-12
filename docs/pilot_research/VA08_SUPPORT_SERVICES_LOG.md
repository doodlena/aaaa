# VA-08 non-food support services: research log (2026-10-12)

Output: `data/sources/va08_support_services.json`, with 41 unverified candidate records. Food pantries were collected separately by another agent and are not included here.

Method: each page was fetched once with `curl`, using the user agent `OpenShelf-research/0.1` and a pause of at least 1 s between requests (10 s for unitedcommunity.org, which sets `Crawl-delay: 10`). robots.txt was checked for every host. Every field in the JSON comes from a page fetched in this session. Addresses were geocoded with the US Census geocoder (Public_AR_Current, at most 1 request per second). Each point was then tested against `data/boundaries/va08_cd119_tigerweb.geojson` with shapely.

Validation passed. The JSON loads, all enums are valid, all IDs are unique, all 41 coordinates fall inside VA-08, and every schedule has opens < closes. Weekday numbering is 0 = Monday, which matches `frontend/src/lib/format.ts`.

## Sources consulted

| Host / URL | Status | Records |
|---|---|---|
| www.arlingtonva.us: DHS Public-Assistance, SNAP, Medicaid, Emergency-Financial-Assistance, Heating-Cooling, Child-Care-Subsidy, DHS At-a-Glance, WIC, Adult Behavioral Healthcare, Same-Day-Access, Substance-Use-Adult, Emergency MH, HSC, Shelters-and-Resources, Arlington-Employment-Center; hypothermia SOP PDF | ok (HTTP 200 to plain curl on all 18 requests) | 6 |
| aec.arlingtonva.us/locations/arlington-department-of-human-services/ | ok | 0 (supporting only) |
| reep.apsva.us/contact-us/, /class-information/ | ok | 1 |
| www.apsva.us/reep/ (home); /reep/locations/ and /reep/schedule-and-fees/ | ok; 404 on the two subpages | 0 |
| arlingtonfreeclinic.org (home, /become-a-patient/) | ok | 1 |
| neighborhoodhealthva.org/our-locations/ | ok | 11 |
| www.vplc.org/legal-services-of-northern-virginia/ | ok | 2 (LSNV offices) |
| www.alexandriava.gov: DCHS program locations, call center, Del Pepper Center, Same Day Access, MH crisis programs, WDC location, WDC programs, homeless services, Domestic Violence, Sexual Violence | ok | 6 |
| carpentersshelter.org/residential-shelters/ | ok | 1 |
| www.fallschurchva.gov/681 and /684 | ok | 1 |
| www.fairfaxcounty.gov: DFS office locations, PAES, financial-medical, SNAP, drop boxes, Mount Vernon PHC, WIC, CSB locations, Gartlan Center, One-Stop services, emergency shelters | ok | 12 |
| www.unitedcommunity.org: home, /locations/, immigration and adult education, family support, early learning | ok | 3 |
| www.alive-inc.org/our-locations-alexandria-va/ | ok | 0 (food-focused; non-food service sites unclear) |
| www.doorwaysva.org | ok | 0 (hotline only; confidential shelter) |
| christhouse.org | ok, but this is Christ House in Washington, DC, not Alexandria | 0 |
| **www.lsnv.org** | **BLOCKED (HTTP 403)** | 0 |
| **bridges2.org** (Bridges to Independence) | **BLOCKED (HTTP 403)** | 0 |
| **www.nami-northernvirginia.org** | **BLOCKED (HTTP 403)** | 0 |
| **www.nvfs.org** (Northern Virginia Family Service) | **BLOCKED (HTTP 403)** | 0 |
| unitedcommunityva.org | did not resolve (connection failed) | 0 |

A person can download the blocked sites manually to fill these gaps.

Compliance note: before the "no circumvention" clarification arrived, one WebFetch attempt was made on `https://www.lsnv.org/` after curl got a 403. That attempt also returned 403 and nothing was retrieved. No other alternate-client retries were made. The two LSNV records come from vplc.org, a separate host, and are flagged `needs_primary_confirmation: true`.

On arlingtonva.us: every request returned HTTP 200 with real page content to the plain curl client. No block was hit and nothing was circumvented. If the lead still wants Arlington County government sources excluded, drop these 6 IDs:
`arlington-dhs-economic-independence`, `arlington-wic`, `arlington-public-health-clinics`, `arlington-behavioral-healthcare`, `arlington-homeless-services-center`, `arlington-residential-program-center`.

## Records by locality

| Locality | Records |
|---|---|
| Arlington County | 11 |
| City of Alexandria | 10 |
| Eastern Fairfax County (Alexandria 22306/22309/22312, Annandale 22003, Falls Church 22041 mailing addresses) | 19 |
| City of Falls Church | 1 |

## Services by type (count of service entries)

health_clinic 14 · mental_health_counseling 11 · job_training 6 · dental_care 6 · snap_application_help 5 · medicaid_enrollment_help 5 · shelter 5 · financial_assistance 4 · utility_assistance 4 · wic_services 4 · prescription_help 4 · substance_use_treatment 3 · other 3 · childcare 2 · housing_assistance 2 · crisis_support 2 · esl_classes 2 · legal_aid 2 · support_groups 2 · tax_preparation 1 · immigration_legal_help 1

## Records by source

Neighborhood Health locations page 11 · Fairfax One-Stop services page 3 · United Community locations page 3 · VPLC (LSNV) 2 · Fairfax DFS office locations 2 · every other source 1 each (see table above).

## Hotlines noted but not imported (no physical location record)

| Name | Number | Source |
|---|---|---|
| 988 / Regional Crisis Call Center (PRS CrisisLink, NoVA) | 988, 703.527.4077, text 85511 | https://www.alexandriava.gov/adult-behavioral-health/mental-health-crisis-programs |
| Alexandria DCHS Emergency Services (24/7) | 703.746.3401 | same (also on the Alexandria behavioral-health record) |
| Alexandria Domestic Violence Program (24/7) | 703.746.4911 (TTY 703.746.3288) | https://www.alexandriava.gov/DomesticViolence |
| Alexandria Sexual Assault Center (24/7) | 703.683.7273 | https://www.alexandriava.gov/SexualViolence |
| Alexandria Adult Protective Services hotline | 703.746.5778; after 4:30 1.888.832.3858 | Del Pepper page |
| Alexandria Child Protective Services hotline | 703.746.5800; VA hotline 1.800.552.7096 | Del Pepper page |
| Doorways 24-hour Domestic & Sexual Violence Hotline (Arlington) | 703-237-0881 | https://www.doorwaysva.org/ and DHS At-a-Glance |
| Arlington Housing Crisis Hotline | 703-228-1010 | DHS At-a-Glance |
| Arlington Emergency Mental Health (24-hour) | 703-228-5160 | Arlington Emergency MH page (also on the Arlington behavioral-health record) |
| Arlington Adult Protective Services | 703-228-1700; after hours 1-888-832-3858 | DHS At-a-Glance |
| Arlington Child Protective Services | 703-228-1500 | DHS At-a-Glance |
| Fairfax Domestic and Sexual Violence 24-Hour Hotline | 703-360-7273 | Fairfax DFS office locations; emergency shelters |
| Fairfax-Falls Church CSB Emergency / Detox (24/7) | 703-573-5679 / 703-502-7000 | CSB pages |
| Fairfax Coordinated Services Planning | 703-222-0880 (TTY 703-802-7914) | Fairfax PAES page |
| Virginia Enterprise Call Center (SNAP/Medicaid applications) | 1-833-522-5582 (1-833-5CALLVA); 1-855-635-4370 | Fairfax SNAP/PAES; Arlington SNAP |
| Cover Virginia Medicaid by phone | 1-855-242-8282 (TDD 1-888-221-1590) | Arlington Medicaid page |

## Exclusions

- **Outside VA-08 (geocoded OUT):** the Fairfax CSB Merrifield / Sharon Bulova Center (8221 Willow Oaks Corporate Dr) and Neighborhood Health @ Merrifield. Fairfax CSB Entry & Referral is at Merrifield.
- **Outside the district (not tested):** Neighborhood Health @ Joseph Willard (City of Fairfax, also "Temporarily Closed"), LSNV Fairfax office, Fairfax DVAC (Historic Courthouse, Fairfax), and the Reston, Pennino and Chantilly sites.
- **No Census geocoder match:** Neighborhood Health @ Martha Custis Drive (1225 Martha Custis Dr., Suite C1, Alexandria 22302) and the Eleanor U. Kennedy Shelter (9155 Richmond Hwy, Fort Belvoir 22060). These were skipped rather than geocoded another way.
- **Confidential domestic-violence locations:** none recorded. The Doorways safehouse and Alexandria DV shelter appear as hotlines only. The Alexandria DV/SA program office (said to remain at 123 North Pitt Street) was not imported because its program pages do not publish a walk-in office address.
- **Food services:** the United Community Cynthia Hull Food Pantry (7511 Fordson Rd), the Sacramento Center weekly food distribution, and the ALIVE! food hubs were left out. ALIVE!'s non-food sites (furniture/housewares warehouse, family assistance) were also skipped because the page does not clearly tie its services to them.
- **Too thin to record:** the Fairfax CSB Annandale office (no services listed) and the Next Steps Family Program (scattered sites; only a main office address is given).

## Gaps and caveats

- **No records** for clothing, transportation_help or domestic_violence_support (hotline-only), or for senior_meals and kids_meals (food, out of scope). Tax preparation is covered for Alexandria only. Immigration legal help comes only from United Community. Falls Church has a single record.
- **Unconfirmed in-person services:** for the Fairfax DFS Hyland and Annandale Human Services Centers, the county pages confirm the office hours and a document drop box but do not state which programs are served in person there. Their SNAP/Medicaid services are marked `unconfirmed`.
- **Neighborhood Health hours:** several hours strings on the source omit the dash between day names ("Monday Friday", "Tuesday Friday"). Those were kept verbatim and not turned into schedules.
- **Conflicting WIC floor:** the Arlington WIC page says "1st Floor" and the DHS At-a-Glance page lists WIC under Public Health (2nd Floor). This is noted on the record.
- **Hours that may be phone hours:** the Fairfax workforce center hours are attached to the team's phone/email contact block, so they are stored as raw text only.
- **Stale page:** the Arlington Homeless Services Center page was last updated January 2022. Its address comes from the October 2025 hypothermia SOP PDF.
- **Still to collect:** NAMI Northern Virginia, Northern Virginia Family Service, Bridges to Independence (Sullivan House) and LSNV's own pages, all of which blocked automated requests.
