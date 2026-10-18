"""Virginia's 8th congressional district (119th Congress; unchanged for the 120th), from Census TIGERweb.

data/boundaries/va08_cd119_tigerweb.geojson: TIGERweb Legislative layer 4, GEOID 5108, generalized to ~5 m
(maxAllowableOffset 0.00005°). While Admin → Site settings → "Only Virginia's 8th district" is on, the public site shows
only listings inside it; listings outside are hidden, never deleted.
"""
import json
from functools import lru_cache

from geoalchemy2 import Geometry
from sqlalchemy import cast, func

from app.config import REPO_ROOT

BOUNDARY = REPO_ROOT / "data" / "boundaries" / "va08_cd119_tigerweb.geojson"


@lru_cache
def geojson() -> str:
    return json.dumps(json.loads(BOUNDARY.read_text())["features"][0]["geometry"])


def contains(geom_column):
    """SQL condition: the point lies inside VA-08."""
    return func.ST_Contains(func.ST_SetSRID(func.ST_GeomFromGeoJSON(geojson()), 4326), cast(geom_column, Geometry))
