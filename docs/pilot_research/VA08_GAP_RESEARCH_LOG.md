# VA-08 gap research log (2026-10-12)

Output: `data/sources/va08_gap_research.json`, with 28 unverified candidate records. These fill gaps left by `va08_web_research.json` and `va08_support_services.json`. No external_id is reused, and no record repeats an existing organization+location+service.

## Method

- **Fetching:** each page was fetched once with `curl`, using the user agent `OpenShelf-research/0.1`. robots.txt was checked per host, and requests were spaced at least 1.1 s apart per host. WebSearch was used only to discover URLs. Every field in the JSON comes from a page or PDF fetched in this session.
- **Blocked hosts:** any 403 was logged and never retried with another client or tool.
- **Geocoding and boundary check:** addresses were geocoded with the US Census geocoder (`Public_AR_Current`, about 1 request per second). Each point was tested against `data/boundaries/va08_cd119_tigerweb.geojson` with shapely. Only points inside VA-08 were kept.
- **Validation:** the JSON was rewritten after each batch of 5 or fewer records (one batch had 6). Every write is validated against `backend/app/vocab.py`: enums, unique IDs, and opens < closes. Weekdays are numbered 0 = Monday.
- **Schedules:** a schedule is created only when the source states an explicit open and close time. Food handouts use `distribution`. Office, class and non-food handout times use `operating_hours`. Past-season hours (VITA 2026) are kept as raw text only.
- **Concurrent writer:** another agent working in the same scratchpad appeared to be researching the same gaps (UA `Lantern-research/0.1`). The build script preserves any records in the output file that this agent did not write. My working files were moved to `scratchpad/gapagent/` so the two agents do not collide.

## Records by gap

| Gap | Records |
|---|---|
| Clothing closets | OLQP Matthew 25 Free Store (Arlington); Catholic Charities Clothing Closet, 125 S West St (Alexandria; **reopens Oct 20, 2026**); The Clothesline for Arlington Kids; Annandale UMC Mission Center (children's clothing, diapers, hygiene) |
| Transportation help | Alexandria DOT Paratransit (123 N Pitt St, Suite 230 is the application mailing address); Senior Services of Alexandria (paratransit call center, Senior Taxi info) |
| DV/SV agency offices (no shelters) | Alexandria Commonwealth's Attorney VWAP/VSTOP (520 King St, Suite 301); Tahirih Justice Center Greater DC office (6400 Arlington Blvd, Suite 400) |
| Falls Church City | Mary Riley Styles Library ESL conversation class; Falls Church Senior Center (50+ activities; **no meal program**, only a pay-your-own "Lunch Bunch") |
| Mental health | Culmore Clinic (free care for uninsured adults; volunteer counseling); Catholic Charities Family Services counseling at St. Charles Borromeo, Our Lady of Lourdes and Good Shepherd parishes |
| Congregation/neighborhood food (Annandale, Seven Corners) | Annandale UMC Mission Center (Thursday pantry; ZIP 22003 only); Food for Others neighborhood sites at Willston, Patrick Henry and Hollywood Rd |
| Senior centers with meals | Fairfax NCS congregate lunch at Minnie H. Peyton/Bailey's, Lincolnia, James Lee and Kingstowne |
| VITA | Gerry Hyland Government Center; VCW Annandale Center (2026 season ended Apr 15; 2027 not yet posted) |
| ESL | English Empowerment Center at Rising Hope, Culmore UMC, Drew CC, Arlington Church of Christ and Mary Riley Styles; Cathedral of St. Thomas More; Annandale UMC Family Literacy |
| Job centers | None added. Existing records already cover Arlington DHS/AEC, Alexandria WDC, VCW Alexandria/Annandale/Cherokee. The Virginia Works Mark Center office is in the same suite as the existing WDC record. |

## Sources fetched

| Host | Status | Use |
|---|---|---|
| www.ourladyqueenofpeace.org, ccda.net (clothing; mental-health counseling), www.clotheslinearlington.org (home, contact, get-clothing), pfva.org | 200 | clothing, counseling |
| www.arlingtonadventist.com | 200 | **excluded**: Arlington, **Texas** church |
| www.fallschurchva.gov (611 Senior Center, 2184 Food Assistance) | 200 | Falls Church |
| www.fairfaxcounty.gov (VITA, DSVS home/counseling/advocacy, senior centers, congregate meals, transportation, James Lee CC, Minnie Peyton CC) | 200, then **403** on `/food-council/providers-accepting-fresh-produce`. All later fairfaxcounty.gov fetches were stopped. 404 on the hollin-hall and lincolnia senior-center slugs. | VITA, senior centers |
| annandalechurch.com (foodministry, clothesministry, esl, missioncenter) | 200 | Annandale UMC |
| www.culmoreclinic.org (home, patient-enrollment, care, contact) | 200 | Culmore Clinic |
| englishempowermentcenter.org (in-person classes + 5 fall-2026 flyer PDFs) | 200 | ESL |
| www.cathedralstm.org | 200 | ESL |
| redeemerarlington.com/esl | 200, redirected to the /ministries/ page | not used |
| www.alexandriava.gov (Paratransit, DOT application PDF 2026-04, DV/SA service hub, Commonwealth's Attorney victim services) | 200 | transportation, DV office |
| seniorservicesalex.org/programs/transportation/ | 200 | transportation |
| www.tahirih.org | 200 | DV/immigration office |
| www.doorwaysva.org/contact-us/ | 200 | no street address published (P.O. Box only), so no record |
| welcomingfallschurch.org, fcswecare.org/programs/ | 200 | FCS food is already recorded (Knox Presbyterian). FCS financial assistance is noted but not added. |
| foodforothers.org/get-help/neighborhood-sites/ | 200 | 3 records |
| www.koinoniafoundation.org | 200 | unrelated grant-maker; not used |
| virginiaworks.gov/local-office/alexandria-mark-center/ | 200 | not added (same suite as existing WDC record) |
| www.stmatthewsumc.org/mission | 404 | — |
| www.vec.virginia.gov/local-office/arlington | 404 (redirected to virginiaworks list) | — |
| **www.arlingtonva.us** (Project PEACE Doorways Court Advocacy; Area Agency on Aging; aec.arlingtonva.us redirects here) | **BLOCKED (403)** | 0. Arlington senior lunch sites (Arlington Mill, Langston-Brown, Walter Reed) were not collected. |
| **www.columbiabaptist.org/foodpantry** | **BLOCKED (403)** | 0. The church's alternate domain (columbia.church) was deliberately **not** tried. |

## Exclusions

- **Outside VA-08:** Wakefield Senior Center at Audrey Moore RECenter, 8100 Braddock Rd (geocoded outside). Also not recorded: the Fairfax DSVS office and the Fairfax NCS transportation office (both at the Government Center in Fairfax), and the Food for Others warehouse at 2938 Prosperity Ave.
- **No Census match:** Hollin Hall Senior Center, 1500 Shenandoah Rd, Alexandria 22308 (tried 3 address variants; no other geocoder used).
- **No street address:** Food for Others Ellison site (an intersection in Falls Church City) and Annandale–Fairmont Gardens (no address or time given).
- **Confidential locations:** none recorded. Doorways and the Alexandria DV/SA programs appear only as hotlines (see `VA08_SUPPORT_SERVICES_LOG.md`).
- **Directory-only leads (not recorded; need an official page):** St. Anthony of Padua (Falls Church) pantry; Woodlawn UMC (7730 Fordson Rd) pantry; Comunidad 3rd-Saturday pantry (6131 Willston Dr); Parkwood Baptist; St. Matthew's UMC (Annandale); Redeemer Church ESL; Arlington senior lunch sites; Columbia Baptist pantry.

## Caveats to confirm

- **Catholic Charities Clothing Closet:** the page says it "will reopen on Tuesday, October 20th, 2026".
- **EEC at Drew Community Center:** the web page says FREE, but the flyer says the fee is $85 (flagged).
- **Culmore Clinic:** pages disagree on the number of days per week and on the income examples. The enrollment phone is 703-260-8429 and the appointment phone is 703-260-8413.
- **Good Shepherd parish (CCDA counseling):** the Census geocoder matched "8710 Old Mount Vernon Rd" rather than Mount Vernon Hwy. Verify the pin.
- **Fairfax senior center lunch:** comes from the county-wide congregate meals page (reserve a day ahead; $8.50 for guests and ages 50-59; a $2–$6 sliding-scale donation for ages 60+). Only Bailey's center page states "noon meal weekdays".
- **Merge candidates:** two ESL records share sites with existing food records (`va08-rising-hope-mission-church`, `va08-culmore-umc-food-ministry`). The VITA records share addresses with existing VCW/Hyland records but cover a different service.
