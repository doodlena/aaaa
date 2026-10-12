# Ingestion run 26 — Manually downloaded pages & PDFs (AI-extracted, verified against the file)

- Status: **partial**
- Source: file://data/sources/manual
- Synthetic fixture source: no

| Metric | Count |
|---|---|
| discovered | 13 |
| inserted | 2 |
| updated | 5 |
| unchanged | 0 |
| rejected | 0 |
| duplicate_candidates | 3 |
| conflicts | 0 |
| needs_review | 417 |
| out_of_scope | 3 |
| gone | 0 |
| fetch_errors | 0 |
| parse_errors | 1 |
| auto_linked | 5 |

## Errors

- [parse] file://data/sources/manual/english-2026-food-assistance-2-page-flyer.pdf: ValidationError: 1 validation error for PageExtraction
  Invalid JSON: EOF while parsing a string at line 1 column 11315 [type=json_invalid, input_value='{"places":[{"organizatio...me":"Food Not Bombs NOV', input_type=str]
    For further information visit https://errors.pydantic.dev/2.14/v/json_invalid

Imported records are unverified candidates; nothing was published or verified by this run.