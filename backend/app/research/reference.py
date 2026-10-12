"""Download public-domain reference data: Census TIGERweb locality boundaries and Census Gazetteer ZCTA centroids."""
import csv
import io
import json
import zipfile

import httpx

from app.config import REPO_ROOT, get_settings
from app.services.registry import load_jurisdiction_configs

TIGERWEB = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/1/query"
GAZETTEER = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_zcta_national.zip"
BOX = (37.9, 39.8, -78.8, -76.3)  # lat_min, lat_max, lon_min, lon_max around Northern Virginia


def import_reference_data() -> dict:
    headers = {"User-Agent": get_settings().http_user_agent}
    fips = sorted({j["county_fips"] for j in load_jurisdiction_configs() if j.get("county_fips")})
    where = "STATE='51' AND COUNTY IN (" + ",".join(f"'{f}'" for f in fips) + ")"
    r = httpx.get(TIGERWEB, params={"where": where, "outFields": "NAME,GEOID,STATE,COUNTY", "f": "geojson", "outSR": 4326,
                                    "geometryPrecision": 5}, headers=headers, timeout=120)
    r.raise_for_status()
    gj = r.json()
    out_b = REPO_ROOT / "data" / "boundaries" / "nova_localities_tigerweb.geojson"
    out_b.write_text(json.dumps(gj))
    z = httpx.get(GAZETTEER, headers=headers, timeout=300, follow_redirects=True)
    z.raise_for_status()
    rows = 0
    with zipfile.ZipFile(io.BytesIO(z.content)) as zf:
        name = next(n for n in zf.namelist() if n.endswith(".txt"))
        reader = csv.reader(io.TextIOWrapper(zf.open(name)), delimiter="\t")
        next(reader)
        out_z = REPO_ROOT / "data" / "reference" / "zcta_centroids_va_dc_md.csv"
        with out_z.open("w", newline="") as fh:
            w = csv.writer(fh)
            w.writerow(["zcta", "lat", "lon"])
            for row in reader:
                lat, lon = float(row[5]), float(row[6].strip())
                if BOX[0] <= lat <= BOX[1] and BOX[2] <= lon <= BOX[3]:
                    w.writerow([row[0], lat, lon])
                    rows += 1
    return {"boundaries": len(gj.get("features", [])), "zcta_rows": rows}
