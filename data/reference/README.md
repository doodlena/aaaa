# Reference data

| File | Source | License | Retrieved |
|---|---|---|---|
| `zcta_centroids_va_dc_md.csv` | US Census Bureau 2024 Gazetteer, ZCTA national file (`2024_Gaz_zcta_national.zip`), filtered to a box around Northern Virginia (lat 37.9–39.8, lon −78.8 to −76.3). Columns: ZCTA, internal point lat/lon. | Public domain (US Government work) | 2026-10-12 |
| `../boundaries/nova_localities_tigerweb.geojson` | US Census TIGERweb `State_County/MapServer/1` query for VA counties/cities 013, 059, 107, 153, 510, 600, 610, 683, 685 (outSR=4326). | Public domain | 2026-10-12 |

ZCTAs approximate USPS ZIP codes; a ZIP search centres the map on the ZCTA's internal point, not on the user's home.
Regenerate with `foodaccess import-reference`.
