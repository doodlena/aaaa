# Pilot division selection report

Generated 2026-10-12T15:03:19Z by `foodaccess pilot-report` from `reports/pilot_research/title_i_division_summary.json`.

> Title I designation and the other indicators below are **prioritization signals**, not measurements of household food insecurity. No individual student or family circumstances are inferred. Scores rank these eight candidates relative to each other only.

## Division indicators (official data)

| Division | Schools | Title I | Title I share | F/R eligible % | CEP schools | ACS <185% FPL | ACS SNAP hh % |
|---|---:|---:|---:|---:|---:|---:|---:|
| Arlington County Public Schools (7) | 36 | 7 | 19.4% | 31 | 10 | 13.8 | 4 |
| Fairfax County Public Schools (29) | 191 | 51 | 26.7% | 36.6 | 48 | 12.7 | 4.3 |
| Loudoun County Public Schools (53) | 98 | 15 | 15.3% | 27.5 | 11 | 8.8 | 3.2 |
| Prince William County Public Schools (75) | 97 | 39 | 40.2% | 55.1 | 69 | 15.5 | 5.8 |
| Alexandria City Public Schools (101) | 17 | 9 | 52.9% | 69.7 | 10 | 16.6 | 5.1 |
| Falls Church City Public Schools (109) | 5 | 1 | 20.0% | 11.7 | 0 | 8 | 1.5 |
| Manassas City Public Schools (143) | 9 | 5 | 55.6% | 78.5 | 9 | 18.4 | 6.3 |
| Manassas Park City Public Schools (144) | 4 | 2 | 50.0% | 81.5 | 4 | 20 | 10.1 |

School year: 2025-2026 (Title I and meal-eligibility files); ACS: 2020–2024 5-year estimates.

## Scoring

| Factor | Weight |
|---|---:|
| Number of Title I schools (2025-26) | 0.2 |
| Share of schools designated Title I | 0.2 |
| Free/reduced-price meal eligible share of NSLP membership (2025-26) | 0.1 |
| Residents below 185% of poverty line (ACS 2020-24) | 0.15 |
| Households receiving SNAP (ACS 2020-24) | 0.1 |
| Listings in the best current structured food-resource source | 0.15 |
| Independent current structured sources (enables cross-checking) | 0.1 |

Each factor is min–max normalized across the candidates; missing factors are excluded and the remaining weights renormalized (shown as weight coverage). Divisions with <80% weight coverage are not eligible for selection.

| Rank | Division | Score | Weight coverage | Missing factors |
|---:|---|---:|---:|---|
| 1 | Prince William County Public Schools | 0.657 | 1.0 | — |
| 2 | Manassas City Public Schools | 0.652 | 1.0 | — |
| 3 | Fairfax County Public Schools | 0.634 | 1.0 | — |
| 4 | Alexandria City Public Schools | 0.543 | 1.0 | — |
| 5 | Manassas Park City Public Schools | 0.526 | 1.0 | — |
| 6 | Arlington County Public Schools | 0.251 | 1.0 | — |
| 7 | Loudoun County Public Schools | 0.145 | 0.75 | food_data_listings, verification_sources |
| 8 | Falls Church City Public Schools | 0.031 | 0.75 | food_data_listings, verification_sources |

## Result

Recommended pilot divisions: **Prince William County Public Schools, Manassas City Public Schools, Fairfax County Public Schools**
→ jurisdictions `fairfax-city, fairfax-county, manassas-city, prince-william-county`.

Apply by listing these jurisdictions in `config/pilot.yaml` and running `foodaccess sync-registry`.

### Sensitivity: equal weights

| Rank | Division | Score |
|---:|---|---:|
| 1 | Manassas City Public Schools | 0.689 |
| 2 | Prince William County Public Schools | 0.661 |
| 3 | Fairfax County Public Schools | 0.622 |
| 4 | Manassas Park City Public Schools | 0.554 |
| 5 | Alexandria City Public Schools | 0.548 |
| 6 | Arlington County Public Schools | 0.279 |
| 7 | Loudoun County Public Schools | 0.154 |
| 8 | Falls Church City Public Schools | 0.023 |

## Food-data evidence used

- **Prince William County Public Schools**: CAFB feed 25; PWC Community Mobilization Network layer 16 food sites (updated 2026-09); 2022 layer stale, excluded
- **Manassas City Public Schools**: City of Manassas food layer 18 (updated 2024-08); CAFB feed 6
- **Fairfax County Public Schools**: CAFB feed 50; Fairfax County Emergency Food Access layer 45 (public display needs county permission)
- **Alexandria City Public Schools**: CAFB feed 14; city directory is a 2024 PDF only
- **Manassas Park City Public Schools**: No Manassas Park sites in CAFB feed; no city layer found
- **Arlington County Public Schools**: CAFB feed 9 sites; AFAC HTML page (5 sites) curatable; arlingtonva.us blocked (403) during research
- **Loudoun County Public Schools**: Not researched in this pass (outside CAFB feed coverage)
- **Falls Church City Public Schools**: Not researched in this pass

## Data warnings per division

**Arlington County Public Schools**
- Denominator = schools listed in the VDOE NSLP free/reduced eligibility report (NSLP-participating public schools); it may differ slightly from other school counts.
- 10 school(s) use the Community Eligibility Provision; VDOE computes their free counts from the Identified Student Percentage, so free/reduced shares there are formula-based, not applications.
- ACS indicators are residence-based 5-year estimates with margins of error; school data are enrollment-based. They are not interchangeable.

**Fairfax County Public Schools**
- 2 Title I school(s) not found in the free/reduced report by school number: Glasgow Middle; Mason Crest Elementary
- Denominator = schools listed in the VDOE NSLP free/reduced eligibility report (NSLP-participating public schools); it may differ slightly from other school counts.
- 48 school(s) use the Community Eligibility Provision; VDOE computes their free counts from the Identified Student Percentage, so free/reduced shares there are formula-based, not applications.
- ACS values aggregate localities 059, 600 served by this division.
- ACS indicators are residence-based 5-year estimates with margins of error; school data are enrollment-based. They are not interchangeable.

**Loudoun County Public Schools**
- Denominator = schools listed in the VDOE NSLP free/reduced eligibility report (NSLP-participating public schools); it may differ slightly from other school counts.
- 11 school(s) use the Community Eligibility Provision; VDOE computes their free counts from the Identified Student Percentage, so free/reduced shares there are formula-based, not applications.
- ACS indicators are residence-based 5-year estimates with margins of error; school data are enrollment-based. They are not interchangeable.

**Prince William County Public Schools**
- 1 Title I school(s) not found in the free/reduced report by school number: Leesylvania Elementary
- Denominator = schools listed in the VDOE NSLP free/reduced eligibility report (NSLP-participating public schools); it may differ slightly from other school counts.
- 69 school(s) use the Community Eligibility Provision; VDOE computes their free counts from the Identified Student Percentage, so free/reduced shares there are formula-based, not applications.
- ACS indicators are residence-based 5-year estimates with margins of error; school data are enrollment-based. They are not interchangeable.

**Alexandria City Public Schools**
- Denominator = schools listed in the VDOE NSLP free/reduced eligibility report (NSLP-participating public schools); it may differ slightly from other school counts.
- 10 school(s) use the Community Eligibility Provision; VDOE computes their free counts from the Identified Student Percentage, so free/reduced shares there are formula-based, not applications.
- ACS indicators are residence-based 5-year estimates with margins of error; school data are enrollment-based. They are not interchangeable.

**Falls Church City Public Schools**
- Denominator = schools listed in the VDOE NSLP free/reduced eligibility report (NSLP-participating public schools); it may differ slightly from other school counts.
- ACS indicators are residence-based 5-year estimates with margins of error; school data are enrollment-based. They are not interchangeable.

**Manassas City Public Schools**
- Denominator = schools listed in the VDOE NSLP free/reduced eligibility report (NSLP-participating public schools); it may differ slightly from other school counts.
- 9 school(s) use the Community Eligibility Provision; VDOE computes their free counts from the Identified Student Percentage, so free/reduced shares there are formula-based, not applications.
- ACS indicators are residence-based 5-year estimates with margins of error; school data are enrollment-based. They are not interchangeable.

**Manassas Park City Public Schools**
- Denominator = schools listed in the VDOE NSLP free/reduced eligibility report (NSLP-participating public schools); it may differ slightly from other school counts.
- 4 school(s) use the Community Eligibility Provision; VDOE computes their free counts from the Identified Student Percentage, so free/reduced shares there are formula-based, not applications.
- ACS indicators are residence-based 5-year estimates with margins of error; school data are enrollment-based. They are not interchangeable.

## Sources

- VDOE 2025-2026 Title I Schools: official URL https://www.doe.virginia.gov/home/showpublisheddocument/64871/638917252795170000; retrieved from https://web.archive.org/web/20251129015802id_/https://www.doe.virginia.gov/home/showpublisheddocument/64871/638917252795170000 (Internet Archive copy of the official file) on 2026-10-12; sha256 2e763fcafa7ac079…
- VDOE School Nutrition — Free and Reduced Eligibility Report by School, 2025-2026 (as of Oct 31, 2025): official URL https://www.doe.virginia.gov/home/showpublisheddocument/76094/639081364709900000; retrieved from https://web.archive.org/web/20260421191352id_/https://www.doe.virginia.gov/home/showpublisheddocument/76094/639081364709900000 (Internet Archive copy of the official file) on 2026-10-12; sha256 36f377d16c891d67…
- U.S. Census Bureau ACS 2020-2024 5-year Summary File (tables B22003 SNAP, C17002 ratio of income to poverty) (b22003): official URL https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/data/5YRData/acsdt5y2024-b22003.dat; retrieved from https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/data/5YRData/acsdt5y2024-b22003.dat (official host) on 2026-10-12; sha256 03c3c8f329c7223b…
- U.S. Census Bureau ACS 2020-2024 5-year Summary File (tables B22003 SNAP, C17002 ratio of income to poverty) (c17002): official URL https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/data/5YRData/acsdt5y2024-c17002.dat; retrieved from https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/data/5YRData/acsdt5y2024-c17002.dat (official host) on 2026-10-12; sha256 dc3dc675113683ec…

## Limitations

- VDOE's site refused automated requests (HTTP 403) during research; the identical official files were obtained from Internet Archive snapshots of the official URLs. Re-run from a network VDOE permits to confirm checksums.
- The school-count denominator is NSLP-participating schools in the meal-eligibility report; alternative directories count specialty/preschool programs differently.
- CEP schools report formula-based free-meal counts, inflating F/R percentages relative to application-based schools.
- Food-data availability reflects one research pass (2026-10-12); Loudoun and Falls Church were not researched and are therefore not eligible this round rather than scored as zero.
- Small divisions (Manassas Park: 4 schools) produce volatile shares.
