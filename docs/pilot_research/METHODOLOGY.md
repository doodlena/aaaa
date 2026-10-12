# Pilot selection methodology

Reproduce everything with:

```bash
foodaccess title-i        # download (or --offline: reuse cache) and compute division indicators
foodaccess pilot-report   # score, rank, and write reports/pilot_research/PILOT_SELECTION_REPORT.md
```

## Inputs

| Indicator | Source | Definition |
|---|---|---|
| Title I schools | VDOE 2025-26 Title I list (sheet `DATA`) | Rows per `DIVISION NUMBER` (schoolwide plus targeted). |
| Total schools | VDOE NSLP free/reduced report by school, 2025-26 | Rows with a 3-digit division and a school number. This is a consistent statewide definition (NSLP-participating public schools), and its keys match the Title I file exactly. |
| Title I share | derived | Title I schools ÷ total schools. All three Title I schools missing from the meal report are listed as warnings. |
| F/R eligible % | same meal report | Σ total F/R eligible ÷ Σ NSLP membership. CEP schools report formula-based counts (flagged). |
| ACS SNAP households % | ACS 2020-24 B22003 | E002 ÷ E001 for the localities the division serves. |
| ACS below 185% FPL % | ACS 2020-24 C17002 | (E002…E006) ÷ E001. 185% FPL is the reduced-price meal threshold. |
| Food-data listings / independent sources | Source research 2026-10-12 | Recorded in `config/pilot_selection.yaml` with notes. `null` means not researched. |

Fairfax County Public Schools serves both Fairfax County and the City of Fairfax, so ACS values for division 29
combine FIPS 059 and 600.

## Score

For each factor *f* with weight *wᶠ* (in `config/pilot_selection.yaml`), values are min-max normalized across the
eight candidates. A division's score is Σ wᶠ·normᶠ ÷ Σ wᶠ over the factors that have data. A missing factor is
**excluded, never imputed**, and divisions with less than 80% of the weight available are not eligible. The report
also shows an equal-weight sensitivity ranking.

## Result (2026-10-12)

Prince William County (0.657), Manassas City (0.652), and Fairfax County (0.634) were selected. The same three rank
top under equal weights. Arlington ranks 6th: it has a low Title I share (19%) and few structured listings. Loudoun
and Falls Church were not eligible because their food-source research has not been done.

## Limitations

- Title I designation is a prioritization signal, not a measurement of food insecurity. No conclusions about
  individual students or families are drawn.
- VDOE blocked automated requests (HTTP 403). The official files were taken from Internet Archive snapshots of the
  exact official URLs. Checksums are recorded so a later direct download can be compared.
- The school-year label (2025-2026) comes from the official link text because the Title I file has no year column.
- ACS (residence-based, 5-year, with margins of error) and school data (enrollment-based) are not interchangeable.
  They are shown side by side, not combined into one ratio.
- Min-max normalization over a few candidates is sensitive to outliers. Small divisions (Manassas Park, with 4
  schools) produce volatile shares.
- The food-data availability factors reflect one research pass and should be refreshed before the next expansion
  round.
