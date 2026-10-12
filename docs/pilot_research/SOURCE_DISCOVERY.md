# Source Discovery: Northern Virginia Food Access Pilot

**Retrieved:** 2026-10-12. Every URL marked CONFIRMED was fetched in this session. The machine-readable version is `source_discovery.json`, and raw samples are in `samples/`.

> **Access warning:** `www.doe.virginia.gov` returns HTTP 403 (Akamai "Access Denied") for every path from this environment, including `robots.txt`, with both curl and WebFetch. All VDOE files below were downloaded from **Internet Archive `id_` snapshots of the exact VDOE URLs**. A production ingester will need a network VDOE does not block, or a manual download step. `www.arlingtonva.us` is blocked the same way.

---

## 1. VDOE Title I school list: CONFIRMED (via Wayback)

| Item | Value |
|---|---|
| Landing page | https://www.doe.virginia.gov/programs-services/federal-programs/essa/title-i/title-i-part-a-improving-basic-programs-operated-by-local-educational-agencies (snapshot 2026-03-09) |
| **2025-2026 Title I Schools** | **https://www.doe.virginia.gov/home/showpublisheddocument/64871/638917252795170000** |
| Fetched from | https://web.archive.org/web/20251129015802id_/https://www.doe.virginia.gov/home/showpublisheddocument/64871/638917252795170000 |
| 2024-2025 | https://www.doe.virginia.gov/home/showpublisheddocument/55829/638567181101070000 |
| 2023-2024 | https://www.doe.virginia.gov/home/showpublisheddocument/53521/638471542088130000 |
| Format | XLSX, 54,440 bytes |
| Sheets | `DATA` (the data) and `SQL` (the extraction query) |
| Header row | 1 |
| Columns | `DIVISION NAME`, `DIVISION NUMBER`, `SCHOOL NAME`, `SCHOOL NUMBER`, `GRADE SPAN SERVED`, `SCHOOL TYPE`, `FOCUS AREA` |
| School year | **Not a column.** It appears only in the link text and file name, so store it as metadata. |
| Rows | 805: 777 "Title I - Schoolwide" and 28 "Title I - Targeted Assistance" |
| Keys | `DIVISION NUMBER` is an int (29, 7, …). `SCHOOL NUMBER` is an int with no zero padding; it is blank for one row (VA School for the Deaf and Blind). |

Search results mentioned a 2026-2027 file, but I could **not verify** it. The newest successful snapshot (2026-03-09) lists 2025-2026 as the latest year.

**NoVA counts (2025-26):**

| Division (No.) | Title I schools |
|---|---|
| Fairfax County Public Schools (29) | 51 |
| Prince William County Public Schools (75) | 39 |
| Loudoun County Public Schools (53) | 15 |
| Alexandria City Public Schools (101) | 9 |
| Arlington County Public Schools (7) | 7 |
| Manassas City Public Schools (143) | 5 |
| Manassas Park City Public Schools (144) | 2 |
| Falls Church City Public Schools (109) | 1 (Targeted Assistance; all other NoVA schools are Schoolwide) |

Sample: `samples/vdoe_title_i_2025_26_first12rows.csv`

## 2. School directory and "total schools"

### CONFIRMED
- **VDOE NSLP Free & Reduced-Price Eligibility, by school, 2025-2026.** This is the recommended denominator.
  - URL: https://www.doe.virginia.gov/home/showpublisheddocument/76094/639081364709900000, fetched from the Wayback snapshot of 2026-04-21.
  - Landing page: https://www.doe.virginia.gov/programs-services/school-operations-support-services/school-nutrition/program-statistics-reports
  - Format: XLSX print-layout report. Sheet `2025-2026 Free-Red School`. Data as of 2025-10-31, published 2026-01-31.
  - Layout: title rows 1–7. Then, for each division: a `DDD-Division Name` row, a header row, the data rows and a TOTALS row. The notes start around row 2400.
  - Columns: `Div. No.`, `School No.`, `School Name`, `CEP*`, `School Type`, `Low Grade`, `High Grade`, `SNP Memb`, `FREE Elig`, `FREE %`, `RED Elig`, `RED %`, `TOTAL F/R Elig`, `TOTAL F/R %`
  - Keys are zero-padded strings ('029', '0020'). Parse rule: keep rows where column A is 3 digits and column B is all digits. That gives 1,893 rows.
  - **It joins to Title I on (int div, int school):** Fairfax 49/51, PWC 38/39, and 100% for every other NoVA division. The unmatched schools are Glasgow Middle 101, Mason Crest ES 453 and Leesylvania ES 83.
  - Schools per division (CEP schools in parentheses): Fairfax 191 (48), Arlington 36 (10), PWC 97 (69), Alexandria 17 (10), Manassas 9 (9), Manassas Park 4 (4), Falls Church 5 (0), Loudoun 98 (11).
  - The report covers every public school that takes part in the NSLP. Its notes say some alternative and specialty centers, Governor's schools and CTE centers do not take part. That makes it a consistent "total schools" denominator.
  - The by-division version is at https://www.doe.virginia.gov/home/showpublisheddocument/76096/639081365046200000. I located it but did not inspect it.
- **VDOE HTML directory:** https://www.va-doeapp.com/PublicSchoolsByDivisions.aspx?w=true
  - Fetched directly. There is no robots.txt (404).
  - One roughly 740 KB page covering 1,863 schools in 131 divisions.
  - Fields: division name, division number (in an `<a name='029'>` anchor), section heading, school name, street address, city/state/ZIP, phone, principal, grades and type.
  - **It has no school number**, so joining it to Title I requires matching on name.
  - Section values: ELEMENTARY, MIDDLE, HIGH, PRESCHOOL, VIRTUAL, CHARTER, ALTERNATIVE, SPECIAL EDUCATION, GOVERNORS, OTHER.
  - NoVA totals across all sections: Fairfax 200, Arlington 36, PWC 96, Alexandria 18, Manassas 10, Manassas Park 4, Falls Church 5, Loudoun 98. Exclude PRESCHOOL, VIRTUAL, GOVERNORS, ALTERNATIVE and SPECIAL EDUCATION to count only standard K-12 schools.
  - Samples: `samples/vdoe_va_doeapp_public_schools_by_division_snippet.html` and `samples/vdoe_va_doeapp_directory_parsed_nova_first5.json`
- **NCES EDGE public school admin data, 2024-25 (ArcGIS):** https://nces.ed.gov/opengis/rest/services/K12_School_Locations/EDGE_ADMINDATA_PUBLICSCH_2425/MapServer/1
  - Returns GeoJSON. maxRecordCount is 2000.
  - Fields: `NCESSCH`, `ST_LEAID` (`VA-029` matches VDOE division 029), `LEA_NAME`, `SCH_NAME`, `LSTREET1`, `LCITY`, `LZIP`, `SCHOOL_TYPE_TEXT`, `SY_STATUS_TEXT`, `NMCNTY`, `CNTY`, **`TOTFRL`, `FRELCH`, `REDLCH`, `DIRECTCERT`**, `TOTAL`, `LATCOD`, `LONCOD`, and others.
  - It has **no state school number**. Negative sentinel values (−2) must be filtered out.
  - NoVA counts: Fairfax 223, Arlington 42, PWC 98, Alexandria 19, Manassas 10, Manassas Park 4, Falls Church 5, Loudoun 102.
  - nces.ed.gov robots.txt does not disallow `/opengis/`.
  - Sample: `samples/nces_edge_admindata_2425_first3.geojson`

### NOT DOWNLOADED
- **VDOE "School List with Principal Contact Information (CSV)", updated 2026-09-25:** https://www.doe.virginia.gov/home/showpublisheddocument/79158/639259469639685164. It is listed on the 2026-10-01 snapshot of https://www.doe.virginia.gov/about-vdoe/virginia-school-directories. The origin returns 403 and the Wayback Machine has no copy, so **I could not confirm its columns.**

## 3. Meal eligibility and CEP: CONFIRMED (via Wayback)
- School-level free/reduced eligibility: see §2 (the NSLP report).
- **CEP ISP report, April 1, 2025 (data year 2024-25, revised 2025-07-01):** https://www.doe.virginia.gov/home/showpublisheddocument/62774/638874780859400000
  - Format: XLSX with sheets `LEA-wide Notification Report` and `School Notification Report`. The header is on row 5.
  - School sheet columns: `LEA ID`, `LEA Name`, `School ID`, `School Name`, `Identified Student Percentage (ISP)`, `Eligible to Participate`, `Near Eligible to Participate`, `Currently Participating`, `Participating as an Individual Site (I=Individual)`, `Participating as Part of a Group of Schools (G=Group)`, `Participating as Part of an Entire Division (D=Divisionwide)`, `Student Enrollment in Near- Eligible, Eligible, and Participating CEP Schools`, `Comments`
  - 1,890 school rows.
  - Quirks: headers contain `_x000D_` (embedded carriage returns), and empty cells hold the literal text "cell intentionally blank".
  - Reports for 2018–2024 are also linked from the same page.
  - Sample: `samples/vdoe_cep_isp_2025_school_sheet_first10rows.csv`

## 4. Census ACS

**The no-key API request is BLOCKED.** `https://api.census.gov/data/2024/acs/acs5/subject?get=NAME,S1701_C03_001E,S2201_C04_002E&for=county:013,059,153,510,683,685,610,107,600&in=state:51` returns **302 → https://api.census.gov/data/missing_key.html**. The same happens for 2023 and even for `/data/2020/dec/pl`, so a free API key is now required.

**The metadata is CONFIRMED and needs no key.** The variable definitions come from `https://api.census.gov/data/2024/acs/acs5/subject/variables/{VAR}.json`:

| Variable | Definition |
|---|---|
| S1701_C03_001E | Percent below poverty level, population for whom poverty status is determined |
| **S2201_C04_001E** | **Percent households receiving food stamps/SNAP, all households. Use this one.** |
| S2201_C04_002E | Percent receiving SNAP among households **with one or more people aged 60+**. This is the variable in the suggested URL, and it is **not** the overall SNAP rate. |

- **The latest ACS 5-year release is 2024.** The 2025 acs5 and acs1 `subject.json` both return 404.
- Recommended call, once you have a key: `https://api.census.gov/data/2024/acs/acs5/subject?get=NAME,S1701_C03_001E,S2201_C04_001E&for=county:013,059,107,153,510,600,610,683,685&in=state:51&key=KEY`

**The values are CONFIRMED and needed no key.** They come from the 2024 ACS 5-year Summary File, which is pipe-delimited:
- https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/data/5YRData/acsdt5y2024-b22003.dat (about 21 MB)
- https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/data/5YRData/acsdt5y2024-c17002.dat (about 42 MB)

I streamed both files and filtered them to `0500000US51xxx`. The formulas are:
- SNAP % = B22003_E002 / B22003_E001
- Poverty % = (C17002_E002 + E003) / E001
- <185% FPL = sum of E002 through E006, divided by E001

| FIPS | Jurisdiction | Households | SNAP HH | SNAP % | Poverty % | <185% FPL % |
|---|---|---|---|---|---|---|
| 51059 | Fairfax County | 414,101 | 17,970 | 4.3 | 5.9 | 12.6 |
| 51013 | Arlington County | 112,027 | 4,480 | 4.0 | 7.4 | 13.8 |
| 51153 | Prince William County | 156,798 | 9,124 | 5.8 | 6.2 | 15.5 |
| 51107 | Loudoun County | 143,032 | 4,541 | 3.2 | 4.2 | 8.8 |
| 51510 | Alexandria city | 76,096 | 3,899 | 5.1 | 7.9 | 16.6 |
| 51600 | Fairfax city | 9,155 | 286 | 3.1 | 9.1 | 15.0 |
| 51610 | Falls Church city | 6,273 | 97 | 1.5 | 4.0 | 8.0 |
| 51683 | Manassas city | 14,203 | 899 | 6.3 | 7.7 | 18.4 |
| 51685 | Manassas Park city | 5,193 | 525 | 10.1 | 5.1 | 20.0 |

These are computed point estimates. The MOE columns (`_M###`) are in the source files and should be kept. Sample: `samples/acs2024_5yr_b22003_c17002_nova.psv`.

**Division ↔ county caveats:**
- Fairfax County Public Schools (division 029) also educates Fairfax City (51600) students. Fairfax City has its own FIPS code but no separate rows in the Title I or F/R lists. This is general knowledge and was not re-verified this session.
- The independent cities map one-to-one: Alexandria 101 = 51510, Falls Church 109 = 51610, Manassas 143 = 51683, Manassas Park 144 = 51685.
- Towns such as Herndon and Vienna sit inside their counties.
- ACS figures are by place of residence, while school F/R counts are by enrollment. Never mix the two in a single ratio.

## 5. Food-resource sources

| Rank | Source | Format / query URL | Count | Fields | Terms | Difficulty |
|---|---|---|---|---|---|---|
| 1 | **CAFB Get Help Map 2026** (owner cafbgis1). Linked from https://www.capitalareafoodbank.org/find-food-assistance/ through the Experience app `d60aa14515d24ac494b37a42aa3dec9c`. | FeatureServer: `https://services.arcgis.com/oCjyzxNy34f0pJCV/arcgis/rest/services/Get_Help_Map_Source_Data/FeatureServer/0/query?where=state%3D%27VA%27&outFields=*&f=geojson` | 329 total. VA: Fairfax 50, PWC 25, Alexandria 14, Arlington 9, Manassas 6 (two county spellings), Loudoun and Manassas Park 0 | name, address, city, zip, county_name, phone, email, lat/lon. For each day: Hours, start/end ×3, Frequency, TEFAP, Choice, FoodFormat, Dmodel, ApptOnly, ResidentsOnly, Reqs, Notes | robots allows everything. The item has no license and I found no ToS page (/terms-of-use is 404). **Attribute CAFB and request permission before public redistribution.** | Low (wide schema) |
| 2 | **Fairfax County Emergency Food Access Providers** (NCS). Experience app `497a2d92adb8497ea07b7277fde3e6e4`. | `https://services1.arcgis.com/ioennV6PpG5Xodq0/arcgis/rest/services/service_28906b317c7e44cab3c60a88f8dc6dc3_form/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson` | 45 (last edit 2026-08-20) | Organization, site, address, phone, website, languages, days, hours text, distribution model, food types, delivery/pickup, walk-ins, **eligibility, income and ID requirements**, ZIPs served, HHS region | robots OK. The [GIS disclaimer](https://www.fairfaxcounty.gov/maps/disclaimer) says "all rights are reserved" and allows reproduction for **internal or personal use**, so **public display needs county permission**. | Low. This is a Survey123 layer with editing enabled, so send **read-only queries only**. |
| 3 | **PWC Community Mobilization Network: Public Resource Locations** | `https://services2.arcgis.com/0Q7l03Ls62VG0fy4/arcgis/rest/services/CMN_Public_Resource_Locations/FeatureServer/0/query?where=Service_Category%3D%27Food%20Assistance%27&outFields=*&f=geojson` | 241 total, 16 "Food Assistance" (last edit 2026-09-15) | Organization_Name, Email, Phone_Number, Address (a single string), Website, Service_Category, Service_Description, Hours_of_Service, How_to_Access_Services, Photo_ID_Required | [pwcva.gov/disclaimer](https://www.pwcva.gov/disclaimer) covers warranty and liability only, with no reuse restriction | Low |
| 4 | **City of Manassas: Food Resources_WFL1** | `https://services1.arcgis.com/3wpOgOChiWXPeFWB/arcgis/rest/services/Food_Resources_WFL1/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson` | 18 (last edit 2024-08-05) | USER_Name, USER_ADDRESS/CITY/ZIP, Comments (hours), Hours, PhoneNumber | "Reference purposes only", no accuracy guarantee | Low, but fields are often null |
| 5 | **AFAC Get Groceries**: https://afac.org/get-groceries/ | HTML. WordPress/FacetWP, with lat/lng in hidden `.location-data` spans | 5 public sites, plus apartment-community sites listed as text | name, address parts, lat, lng, hours | robots allows everything | Low, but the list is tiny and better curated by hand. Referral required. |
| 6 | PWC Food Distribution Sites (2022) | `https://services2.arcgis.com/0Q7l03Ls62VG0fy4/arcgis/rest/services/Food_Distribution_Sites/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson` | 31 | category, name, address, phone, hours, requirements, website | PWC disclaimer | **Stale (2022-09)**, so use only as a cross-check |
| 7 | DC Open Data: CAFB Emergency Food Providers | `https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Public_Safety_WebMercator/MapServer/26/query?where=STATE%3D%27VA%27&outFields=*&f=geojson` | 691 total, 169 VA | agency, address, program, lat/lon | **CC BY 4.0** | Low, but the data is from **2015** |
| 8 | Fairfax PDFs: [food-resources-web.pdf](https://www.fairfaxcounty.gov/health/sites/health/files/assets/documents/pdf/food-resources-web.pdf) (last modified 2023-07-13) and the [Food Council PDF](https://www.fairfaxcounty.gov/food-council/sites/food-council/files/assets/documents/pdf/fairfax-food-resources.pdf) (2019) | PDF (HEAD request only) | ? | ? | county copyright | High, and stale |
| 9 | [Alexandria Food Resource Directory, May 2024](https://www.alexandriava.gov/sites/default/files/2024-05/alexandria_food_directory.pdf) | PDF (HEAD request only; 242,700 bytes) | ? | According to a search snippet: name, address, days/times, requirements | robots OK | High. No Alexandria ArcGIS layer was found. |

**BLOCKED or NOT FOUND:**
- arlingtonva.us, including robots.txt and the 2025 food brochure PDF, returned 403 (Akamai).
- I found no Arlington, Alexandria or Loudoun food-pantry layer through ArcGIS Online search.
- ArcGIS REST hosts (`services*.arcgis.com/robots.txt`) return 403 "Invalid URL", meaning they have no robots policy; www.arcgis.com robots allows everything.
- 211 Virginia and findhelp.org appeared in search results but were **not evaluated**.

Samples:
- `cafb_get_help_first3.geojson` — removed from the repository (unlicensed dataset); schema reproduced synthetically in `backend/tests/fixtures/cafb_schema_synthetic.geojson`
- `fairfax_food_access_first3.geojson` — removed from the repository (county reuse restricted); see `backend/tests/fixtures/fairfax_schema_synthetic.geojson`
- `pwc_cmn_food_first3.geojson`
- `pwc_food_distribution_sites_2022_first3.geojson`
- `manassas_food_resources_first3.geojson`
- `afac_get_groceries_snippet.html` — removed from the repository (third-party page content)
- `dc_opendata_cafb_emergency_food_providers_2015_first3.geojson`

## 6. OpenStreetMap Overpass: CONFIRMED (HTTP 200)

```
[out:json][timeout:60];
(nwr["social_facility"="food_bank"](38.40,-77.70,39.10,-76.95);
 nwr["amenity"="food_bank"](38.40,-77.70,39.10,-76.95);
 nwr["social_facility:for"~"food"](38.40,-77.70,39.10,-76.95););
out center tags;
```

- The query returned 11 elements in the bbox, and most are in DC.
- **Only 3 are in NoVA:**
  - Arlington Food Assistance Center (node 10298717235)
  - An unnamed food_bank near the Arlington/Alexandria line (way 406961120; I did not reverse-geocode it)
  - Western Fairfax Christian Ministries (node 13418250627)
- Prince William, Alexandria, Manassas and Loudoun returned 0.
- All matches are tagged `amenity=social_facility` + `social_facility=food_bank`.
- A name-regex query (`pantry|food bank`) **timed out (504)**.

Usage policy, from wiki.openstreetmap.org/wiki/Overpass_API:
- Fewer than 10,000 queries per day and less than 1 GB per day is safe. For regular use, divide those limits by 100.
- Send an identifying User-Agent, and do not run scripts in parallel.
- Commercial use should go through a self-hosted server.
- After a 429 or 406, wait 30 s before retrying.

The data is licensed under ODbL. **Verdict:** OSM is too sparse to be a primary source, so use it only for supplementary or validation checks. Sample: `samples/osm_overpass_foodbank_nova_bbox.json`.
