# NoVA sexual & reproductive health services: research log (2026-10-12)

Output: `data/sources/nova_reproductive_health.json`, with 29 unverified candidate records (7 flagged `needs_primary_confirmation`). Every point was checked with shapely and falls inside a NoVA locality polygon (`nova_localities_tigerweb.geojson`). Services are reported neutrally, as each source states them. No source fetched this session lists abortion care at a NoVA physical location, so none is recorded.

**Method:** Pages were fetched with curl using the user agent `OpenShelf-research/0.1`. robots.txt was checked for each host, requests to any one host were spaced at least 1.2 s apart, and nothing was retried after a block. Addresses were geocoded with the US Census geocoder (Public_AR_Current). Two addresses got no Census match and use the source's own coordinates instead (noted per record). The JSON was written after every 5 records and validated against `backend/app/vocab.py`. All schedules have `opens < closes`, and weekdays are numbered 0 = Monday.

**Title X:** opa-fpclinicdb.hhs.gov is an Angular app. Its bundle calls `https://api.reproductivehealthservices.gov/v1/clinics` (that host's robots.txt returns 404, so no rules apply). One radius query (lat 38.85, lon -77.30, range 40) returned 62 clinics. Nine are inside NoVA: 3 Alexandria Health Dept sites, 4 Neighborhood Health sites, Arlington County Public Health, and the Loudoun County Health Dept. Per-clinic detail records were fetched for those nine. No Fairfax County, Prince William, City of Fairfax, Falls Church or Manassas Title X site is listed.

**Planned Parenthood:** the plannedparenthood.org sitemap (200) lists Virginia health centers only in Charlottesville, Chesapeake, Hampton, Richmond, Roanoke and Virginia Beach, plus virtual centers. None is in NoVA. The nearest ones in the OPA data are in Maryland and DC. The state listing page `/health-center/virginia` returned HTTP 403 and was not retried. **No PP records.**

## Records by locality
- Fairfax County: 11 (4 Health Dept public health centers, NH Richmond Hwy, 3 HealthWorks, 3 Inova Cares for Women)
- City of Alexandria: 7 (AHD main office, 2 Teen Wellness Centers, 3 Neighborhood Health, Inova Cares for Women Alexandria)
- Prince William County: 6 (PWHD Manassas and Woodbridge, 3 Lunera Health, Inova Cares for Women Fettler Park)
- Loudoun County: 4 (Health Dept Leesburg, HealthWorks Leesburg and Sterling, Inova Cares for Women Loudoun)
- Arlington County: 1 (Title X data only, because the county site is blocked)
- City of Fairfax, Falls Church, Manassas, Manassas Park: 0. The PWHD "Manassas" clinic at 9301 Lee Ave and Lunera Manassas both fall inside the Prince William County polygon.

## By service type (records containing)
- reproductive_health: 23
- prenatal_care: 18

## Record IDs
- nova-rh-alexandria-health-dept-mark-center (Alexandria city; reproductive_health, prenatal_care)
- nova-rh-alexandria-teen-wellness-king-st (Alexandria city; reproductive_health)
- nova-rh-alexandria-teen-wellness-minnie-howard (Alexandria city; reproductive_health)
- nova-rh-neighborhood-health-casey (Alexandria city; prenatal_care, reproductive_health)
- nova-rh-neighborhood-health-mark-center (Alexandria city; prenatal_care, reproductive_health)
- nova-rh-neighborhood-health-martha-custis (Alexandria city; prenatal_care, reproductive_health)
- nova-rh-neighborhood-health-richmond-highway (Fairfax County; reproductive_health)
- nova-rh-arlington-public-health-sequoia (Arlington County; reproductive_health)
- nova-rh-loudoun-health-dept-leesburg (Loudoun County; reproductive_health, prenatal_care)
- nova-rh-fairfax-annandale-phc (Fairfax County; reproductive_health, prenatal_care)
- nova-rh-fairfax-mount-vernon-phc (Fairfax County; reproductive_health, prenatal_care)
- nova-rh-fairfax-herndon-reston-phc (Fairfax County; reproductive_health, prenatal_care)
- nova-rh-fairfax-franconia-springfield-phc (Fairfax County; reproductive_health, prenatal_care)
- nova-rh-pwhd-manassas (Prince William County; reproductive_health)
- nova-rh-pwhd-woodbridge (Prince William County; reproductive_health)
- nova-rh-lunera-manassas (Prince William County; prenatal_care, reproductive_health)
- nova-rh-lunera-woodbridge (Prince William County; prenatal_care, reproductive_health)
- nova-rh-lunera-dumfries (Prince William County; prenatal_care, reproductive_health)
- nova-rh-healthworks-herndon (Fairfax County; reproductive_health)
- nova-rh-healthworks-leesburg (Loudoun County; reproductive_health)
- nova-rh-healthworks-reston (Fairfax County; reproductive_health)
- nova-rh-healthworks-sterling (Loudoun County; reproductive_health)
- nova-rh-healthworks-sully-herndon (Fairfax County; reproductive_health)
- nova-rh-inova-cares-women-alexandria (Alexandria city; prenatal_care)
- nova-rh-inova-cares-women-falls-church (Fairfax County; prenatal_care)
- nova-rh-inova-cares-women-herndon (Fairfax County; prenatal_care)
- nova-rh-inova-cares-women-mount-vernon (Fairfax County; prenatal_care)
- nova-rh-inova-cares-women-loudoun (Loudoun County; prenatal_care)
- nova-rh-inova-cares-women-fettler-park (Prince William County; prenatal_care)

## Discrepancies / flags
- NH Martha Custis: OPA gives "125 Martha Custis Dr" and NH gives "1225 Martha Custis Dr., Suite C1". The Census geocoder matched neither, so the OPA coordinates are used and the record is flagged.
- NH Mark Center: OPA gives "Suite 4206" and NH gives "3rd Floor".
- PWHD Woodbridge: the clinical-services page says "Suite 10" and the contact page says "Suite 101".
- Arlington: data comes only from OPA, which lists hours as unknown. Census matched "2100 S WASHINGTON BLVD", about 60 m from the OPA point. The record is flagged.
- Fairfax STI treatment/consult days per site were read from a flattened HTML table. A person should confirm them.
- HealthWorks: women's health and family planning come from an organization-wide services page, not from each site, so these records are `unconfirmed` and flagged.
- Inova Cares for Women: hours come from structured location data, not verbatim text. The Fettler Park (Dumfries) opening was announced for January 6, 2026, and that record is flagged.
- Lunera Health (the page title says "formerly GPW Health Center"): hours were inconsistent across page sections, so none were recorded.
- The community health center sites (Neighborhood Health, HealthWorks, Lunera) may duplicate the separate HRSA import, `hrsa_nova_sites.json`.

## Blocked / not retrieved (not retried with any other client)
- **www.arlingtonva.us**: HTTP 403 on robots.txt.
- **health.arlingtonva.us**: HTTP 403.
- **www.plannedparenthood.org/health-center/virginia**: HTTP 403. The sitemap was used instead.
- healthworksnova.org did not resolve. The correct domain, hwnova.org, was found and used.
- www.loudoun.gov/1279/Family-Planning returned 404. The correct page, /1551/, was used.
- Not attempted for time: pregnancy resource centers / free pregnancy-test centers, City of Fairfax (fairfaxva.gov returned 403 in earlier runs), the Manassas and Manassas Park city sites, and the Inova Juniper (HIV) program.

## Fetch log (URL | HTTP status)
| URL | status |
|---|---|
| https://www.plannedparenthood.org/robots.txt | 200 |
| https://opa-fpclinicdb.hhs.gov/robots.txt | 200 |
| https://www.arlingtonva.us/robots.txt | 403 |
| https://www.alexandriava.gov/robots.txt | 200 |
| https://www.fairfaxcounty.gov/robots.txt | 200 |
| https://www.loudoun.gov/robots.txt | 200 |
| https://www.vdh.virginia.gov/robots.txt | 404 |
| https://www.neighborhoodhealthva.org/robots.txt | 200 |
| https://healthworksnova.org/robots.txt | 000 |
| https://www.gpwhealthcenter.org/robots.txt | 200 |
| https://www.plannedparenthood.org/sitemap.xml | 200 |
| https://www.plannedparenthood.org/health-center/virginia | 403 |
| https://opa-fpclinicdb.hhs.gov/main-5WW47F4S.js | 200 |
| https://api.reproductivehealthservices.gov/robots.txt | 404 |
| https://api.reproductivehealthservices.gov/v1/clinics?latitude=38.85&longitude=-77.30&range=40&limit=100 | 200 |
| https://api.reproductivehealthservices.gov/v1/clinics/65d1c86a-a563-4c9f-a003-c78ae34b0d6f | 200 |
| https://api.reproductivehealthservices.gov/v1/clinics/ab897d83-5a1b-4ac3-9850-ee96536bccba | 200 |
| https://api.reproductivehealthservices.gov/v1/clinics/95d986e4-7dbd-4838-aa88-ab5d627a0745 | 200 |
| https://api.reproductivehealthservices.gov/v1/clinics/85952503-fb2a-4ffc-8143-44edc5faf581 | 200 |
| https://api.reproductivehealthservices.gov/v1/clinics/142d504e-4e22-4f4d-86e1-e288fe55a58e | 200 |
| https://api.reproductivehealthservices.gov/v1/clinics/1f05ac1e-af51-40fc-80a7-c074d025ee86 | 200 |
| https://api.reproductivehealthservices.gov/v1/clinics/c44d68d4-bf8c-4315-a3c4-ddb3568476ff | 200 |
| https://api.reproductivehealthservices.gov/v1/clinics/1eb33900-4ce7-4579-9853-bf25305b9bfe | 200 |
| https://api.reproductivehealthservices.gov/v1/clinics/e523cae5-4f46-4b6b-a0fb-6ff818b30ee9 | 200 |
| https://www.alexandriava.gov/health-department/program/clinical-services | 200 |
| https://www.fairfaxcounty.gov/health/clinics | 200 |
| https://www.loudoun.gov/1279/Family-Planning | 404 |
| https://www.alexandriava.gov/health-department/sexual-and-reproductive-health-in-alexandria | 200 |
| https://www.fairfaxcounty.gov/health/clinics/annandale-district-office | 200 |
| https://www.fairfaxcounty.gov/health/clinics/mount-vernon-district-office | 200 |
| https://www.fairfaxcounty.gov/health/clinics/herndon-reston-district-office | 200 |
| https://www.fairfaxcounty.gov/health/clinics/franconia-springfield-public-health-center | 200 |
| https://www.fairfaxcounty.gov/health/sexually-transmitted-infections | 200 |
| https://www.loudoun.gov/health | 200 |
| https://www.loudoun.gov/1258/Health-Clinics | 200 |
| https://www.loudoun.gov/1551/Family-Planning-Maternity-Care | 200 |
| https://www.loudoun.gov/1539/AIDS-HIV | 200 |
| https://www.loudoun.gov/6126/Maternity-Care | 200 |
| https://www.loudoun.gov/1576/Sexually-Transmitted-Infections | 200 |
| https://www.vdh.virginia.gov/prince-william/ | 200 |
| https://www.vdh.virginia.gov/prince-william/clinical-services/ | 200 |
| https://www.vdh.virginia.gov/prince-william/services-programs/sti/ | 200 |
| https://www.vdh.virginia.gov/prince-william/contact/ | 200 |
| https://www.vdh.virginia.gov/prince-william/services-programs/preventive-health-services/ | 200 |
| https://neighborhoodhealthva.org/sitemap.xml | 200 |
| https://neighborhoodhealthva.org/ | 200 |
| https://neighborhoodhealthva.org/service/prenatal-care/ | 200 |
| https://neighborhoodhealthva.org/service/obstetrics-gynecology/ | 200 |
| https://neighborhoodhealthva.org/our-locations/ | 200 |
| https://www.hwnova.org/robots.txt | 200 |
| https://lunerahealth.org/robots.txt | 200 |
| https://www.hwnova.org/ | 200 |
| https://lunerahealth.org/ | 200 |
| https://lunerahealth.org/service/obstetrics-gynecology/ | 200 |
| https://lunerahealth.org/service/sti/ | 200 |
| https://lunerahealth.org/location/manassas/ | 200 |
| https://lunerahealth.org/location/woodbridge/ | 200 |
| https://lunerahealth.org/location/dumfries/ | 200 |
| https://lunerahealth.org/about/ | 200 |
| https://hwnova.org/service/medical-services/ | 200 |
| https://hwnova.org/locations/herndon-location/ | 200 |
| https://hwnova.org/locations/leesburg-location/ | 200 |
| https://hwnova.org/locations/reston-location/ | 200 |
| https://hwnova.org/locations/sterling/ | 200 |
| https://hwnova.org/locations/sully-herndon/ | 200 |
| https://www.inova.org/robots.txt | 200 |
| https://www.inova.org/our-services/inova-cares-women | 404 |
| https://www.inova.org/our-services/inova-cares-for-women | 200 |
| https://health.arlingtonva.us/robots.txt | 403 |
| https://opa-fpclinicdb.hhs.gov/chunk-*.js (8 bundle files) | 200 |
| https://api.reproductivehealthservices.gov/v1/clinics/{id} (9 NoVA clinics) | 200 |
| geocoding.geo.census.gov (31 lookups) | 200 |
