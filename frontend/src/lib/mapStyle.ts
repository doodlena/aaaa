import type { StyleSpecification } from 'maplibre-gl';

/**
 * Map provider abstraction. The primary style is a MapLibre style URL (default: OpenFreeMap "liberty", free and keyless).
 * If it fails to load we switch to a plain raster OpenStreetMap style. Swap providers via VITE_MAP_STYLE_URL.
 */
export const DEFAULT_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

export function primaryStyleUrl(): string {
  const v = import.meta.env.VITE_MAP_STYLE_URL as string | undefined;
  return v && v.trim() ? v.trim() : DEFAULT_STYLE_URL;
}

export const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

export const MAP_ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> · © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';

/** Northern Virginia overview (lon, lat). */
export const NOVA_CENTER: [number, number] = [-77.25, 38.85];

/** 64-point polygon approximating a circle of `km` around a point. */
export function circlePolygon(lon: number, lat: number, km: number, steps = 64): GeoJSON.Feature<GeoJSON.Polygon> {
  const coords: [number, number][] = [];
  const dLat = km / 110.574;
  const dLon = km / (111.32 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    coords.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [coords] } };
}

export function reducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}
