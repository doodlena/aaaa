# NoVA (outside VA-08) non-food support services: research log (2026-10-12)

Output: `data/sources/nova_support_services.json`, with 39 unverified candidate records (22 flagged `needs_primary_confirmation`). Every record is a point inside a NoVA locality polygon (`nova_localities_tigerweb.geojson`) and outside VA-08 (`va08_cd119_tigerweb.geojson`). Both checks were run with shapely.

**Excluded by design:** SAMHSA treatment facilities, HRSA health centers and NVRC homeless shelters, because they are imported separately. The Fairfax County shelters (Hanley, Fair Ridge, Embry Rucker) and the Fairfax Detoxification Center were drafted and then removed for that reason. Food pantries and markets are also excluded.

**Method:** Pages were fetched with curl using the user agent `OpenShelf-research/0.1`. robots.txt was checked for each host, requests to any one host were spaced at least 1.2 s apart, and nothing was retried after a block. Addresses were geocoded with the US Census geocoder (Public_AR_Current, at least 1.1 s between requests). Vocabulary was checked against `backend/app/vocab.py`. The JSON was rewritten and validated after each batch of records. Weekdays are numbered 0 = Monday.

**Provenance:** This run continued an earlier interrupted run in the same session. That run's 17 drafted Fairfax DFS, CSB, Health Dept, WIC, shelter and workforce records came from fairfaxcounty.gov pages it fetched this session. Of those, 12 were kept and 5 were dropped: the 3 shelters and the detox center (covered by the separate imports above), and Inova Cares WIC, which falls inside VA-08.

## Records by locality
- Fairfax County (western/central): 23
- Loudoun County: 15
- City of Manassas: 1 (LSNV Prince William office)
- City of Fairfax and Manassas Park: 0 (fairfaxva.gov is blocked; Manassas Park was not reached)

## Record IDs
- nova-svc-fairfax-dfs-pennino (Fairfax County)
- nova-svc-fairfax-dfs-lake-anne (Fairfax County)
- nova-svc-fairfax-dsvs-pennino (Fairfax County)
- nova-svc-fairfax-dvac (Fairfax County)
- nova-svc-fairfax-csb-sharon-bulova-center (Fairfax County)
- nova-svc-fairfax-csb-chantilly (Fairfax County)
- nova-svc-fairfax-csb-reston-northwest (Fairfax County)
- nova-svc-fairfax-herndon-reston-phc (Fairfax County)
- nova-svc-fairfax-franconia-springfield-phc (Fairfax County)
- nova-svc-fairfax-wic-sully-healthworks (Fairfax County)
- nova-svc-fairfax-reston-employment-resource-center (Fairfax County)
- nova-svc-fairfax-employment-resource-center-pennino (Fairfax County)
- nova-svc-loudoun-ashburn-senior-center (Loudoun County)
- nova-svc-loudoun-carver-senior-center (Loudoun County)
- nova-svc-loudoun-dulles-south-senior-center (Loudoun County)
- nova-svc-loudoun-senior-center-cascades (Loudoun County)
- nova-svc-loudoun-senior-center-leesburg (Loudoun County)
- nova-svc-loudoun-dfs-leesburg-rehau (Loudoun County)
- nova-svc-loudoun-dfs-sterling (Loudoun County)
- nova-svc-loudoun-wic-leesburg (Loudoun County)
- nova-svc-loudoun-health-ashburn-clinic (Loudoun County)
- nova-svc-loudoun-health-leesburg-clinic (Loudoun County)
- nova-svc-loudoun-mhsads-leesburg (Loudoun County)
- nova-svc-loudoun-mhsads-sterling (Loudoun County)
- nova-svc-loudoun-free-clinic (Loudoun County)
- nova-svc-loudoun-workforce-resource-center (Loudoun County)
- nova-svc-fairfax-herndon-senior-center (Fairfax County)
- nova-svc-fairfax-lorton-senior-center (Fairfax County)
- nova-svc-fairfax-sully-senior-center (Fairfax County)
- nova-svc-fairfax-wakefield-senior-center (Fairfax County)
- nova-svc-fairfax-burke-springfield-center-active-adults (Fairfax County)
- nova-svc-fairfax-arbor-row-center (Fairfax County)
- nova-svc-fairfax-human-services-mobility-management (Fairfax County)
- nova-svc-fcps-adult-esol-chantilly-hs (Fairfax County)
- nova-svc-fcps-adult-esol-herndon-learning-center (Fairfax County)
- nova-svc-fcps-adult-esol-woodson-hs (Fairfax County)
- nova-svc-lsnv-loudoun (Loudoun County)
- nova-svc-lsnv-prince-william (Manassas city)
- nova-svc-wfcm-chantilly-client-services (Fairfax County)

## Sources fetched this run
| URL | Status |
|---|---|
| https://www.loudoun.gov/Facilities/Facility/Details/Ashburn-Senior-Center-177 | 200 |
| https://www.loudoun.gov/1139/Senior-Centers | 200 |
| https://www.loudoun.gov/Facilities/Facility/Details/Carver-Center-70 | 200 |
| https://www.loudoun.gov/Facilities/Facility/Details/Dulles-South-Senior-Center-73 | 200 |
| https://www.loudoun.gov/Facilities/Facility/Details/Loudoun-County-Senior-Center-at-Cascades-72 | 200 |
| https://www.loudoun.gov/Facilities/Facility/Details/The-Senior-Center-of-Leesburg-74 | 200 |
| https://www.loudoun.gov/1122/Family-Services | 404 |
| https://www.loudoun.gov/familyservices | 200 |
| https://www.loudoun.gov/familyservices | 200 |
| https://www.loudoun.gov/6385/Shenandoah-Office-Building-Relocation-of | 200 |
| https://www.loudoun.gov/4405/Food-Assistance | 200 |
| https://www.loudoun.gov/4410/Medicaid | 200 |
| https://www.loudoun.gov/1578/WIC-Program | 200 |
| https://www.loudoun.gov/1258/Health-Clinics | 200 |
| https://www.loudoun.gov/mhsads | 200 |
| https://www.loudoun.gov/6274/Same-Day-Access | 200 |
| https://www.loudounfreeclinic.org/ | 200 |
| https://loudounfreeclinic.org/become-a-patient/ | 200 |
| https://loudounfreeclinic.org/location/ | 200 |
| https://www.loudoun.gov/1592/Workforce-Resource-Center | 200 |
| https://www.fairfaxcounty.gov/neighborhood-community-services/older-adults/senior-centers | 404 |
| https://www.fairfaxcounty.gov/neighborhood-community-services/senior-centers | 200 |
| https://www.fairfaxcounty.gov/neighborhood-community-services/transportation | 200 |
| https://www.fairfaxcounty.gov/neighborhood-community-services/transportation/fastran | 200 |
| https://www.fairfaxcounty.gov/neighborhood-community-services/transportation/tops | 200 |
| https://www.loudoun.gov/1416/Transportation | 200 |
| https://www.loudoun.gov/1104/Adults-55 | 200 |
| https://www.loudoun.gov/6086/Senior-Services | 200 |
| https://www.loudoun.gov/TransitMobility | 200 |
| https://www.loudoun.gov/1131/VICAP-Medicare-Counseling-Program | 200 |
| https://www.fairfaxcounty.gov/health/clinics | 200 |
| https://www.fairfaxva.gov/ | 403 |
| https://www.fcps.edu/academics/adult-and-community-education | 404 |
| https://www.fcps.edu/academics/adult-and-community-education-ace/adult-esol | 200 |
| https://www.vplc.org/legal-services-of-northern-virginia/ | 200 |
| https://www.lawsva.org/ | 000 |
| https://lcsj.org/contact/ | 403 |
| https://www.wfcmva.org/our-services | 200 |
| https://www.wfcmva.org/get-help | 200 |

Note: loudoun.gov/familyservices was fetched twice by mistake (two requests, more than 1 s apart).

## Blocked or unavailable (not retried, no other client used)
- **www.fairfaxva.gov** (City of Fairfax): HTTP 403. No City of Fairfax records.
- **lcsj.org** (LAWS Domestic Violence & Sexual Assault Services, Leesburg): HTTP 403. No record.
- **www.lawsva.org**: connection failed.
- **www.lsnv.org**: HTTP 403 in the VA-08 run, so it was not requested again. The LSNV offices come from the VPLC directory page and are flagged `needs_primary_confirmation`.

## Gaps and not imported
- **No geocoder match:** Jim Scott Senior Center (3001 Vaden Drive, Fairfax 22031), LSNV Fairfax Office (10700 Page Avenue, Fairfax 22030), Hollin Hall Senior Center (22308, which is probably in VA-08). These need manual geocoding.
- **Dropped as inside VA-08:** James Lee, Kingstowne, Lewinsville and Lincolnia senior centers; FCPS Adult ESOL at Plum Center, Edison HS, Graham Road and Bryant Center; Inova Cares WIC.
- **Programs with no walk-in address, so not imported:**
  - Loudoun Transit Mobility Assistance Program (703-771-5665 option 2, https://www.loudoun.gov/TransitMobility)
  - Loudoun VICAP Medicare counseling (https://www.loudoun.gov/1131)
  - Cover Virginia (1-855-242-8282)
  - VDSS Enterprise Call Center (1-855-635-4370)
- **VITA:** Out of season (October). No current 2026 site list was fetched, so no records. Recheck in January.
- **Not reached this run:** Loudoun clothing closets, Manassas Park, Prince William (low priority), and Loudoun adult ESL.
- **Closed or temporarily closed** per the NCS page: Little River Glen (renovation), South County, Pimmit Hills.

## Hotlines (listed only, not imported)
- Fairfax County Domestic & Sexual Violence 24-hour Hotline: 703-360-7273
- Fairfax DVAC: 703-246-4573
- Fairfax-Falls Church CSB Emergency Services (24/7): 703-573-5679
- CSB Entry, Assessment & Referral: 703-383-8500
- Fairfax Detoxification Center (24/7): 703-502-7000
- Loudoun MHSADS Emergency Services: 703-777-0320
- Loudoun MHSADS New Client Information and Referrals: 703-771-5155
- Virginia Senior Medicare Patrol fraud hotline: 1-800-938-8885
