import maplibregl, { type GeoJSONSource, type Map as MLMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ResourceSummary } from '../api/types';
import { circlePolygon, FALLBACK_STYLE, MAP_ATTRIBUTION, NOVA_CENTER, primaryStyleUrl, reducedMotion } from '../lib/mapStyle';
import { useSelection, type SelectionStore } from '../state/selection';
import { useMediaQuery } from '../lib/useMediaQuery';
import { Icon } from './Icon';

export interface MapViewProps {
  items: ResourceSummary[];
  /** 1-based list number of the first confirmed item (matches the list numbering). */
  indexOffset?: number;
  uncertain: ResourceSummary[];
  center: { lat: number; lon: number } | null;
  radiusKm: number | null;
  store: SelectionStore;
  onSearchArea?: (bbox: [number, number, number, number]) => void;
}

const SRC = 'resources';
const RADIUS_SRC = 'search-radius';
const CLUSTER_MAX_ZOOM = 13;

type Kind = 'verified' | 'stale' | 'reported' | 'uncertain';

function toGeoJSON(items: ResourceSummary[], uncertain: ResourceSummary[], indexOffset: number): GeoJSON.FeatureCollection<GeoJSON.Point> {
  const feat = (r: ResourceSummary, kind: Kind, label: string): GeoJSON.Feature<GeoJSON.Point> => ({
    type: 'Feature',
    id: r.id,
    properties: { id: r.id, kind, label, name: r.name, synthetic: r.is_synthetic, live: r.live?.status ?? '' },
    geometry: { type: 'Point', coordinates: [r.lon as number, r.lat as number] },
  });
  const seen = new Set<number>();
  const out: GeoJSON.Feature<GeoJSON.Point>[] = [];
  items.forEach((r, i) => {
    if (r.lat === null || r.lon === null || seen.has(r.id)) return;
    seen.add(r.id);
    out.push(feat(r, r.verification_label === 'verified' ? 'verified' : r.verification_label === 'source_reported' ? 'reported' : 'stale', String(indexOffset + i)));
  });
  uncertain.forEach((r) => {
    if (r.lat === null || r.lon === null || seen.has(r.id)) return;
    seen.add(r.id);
    out.push(feat(r, 'uncertain', '?'));
  });
  return { type: 'FeatureCollection', features: out };
}

/**
 * MapLibre map with GeoJSON clustering. Clusters and points are rendered as HTML markers so that status is shown with
 * shape + symbol + text (solid = verified, dashed ring = needs re-check, dashed "?" = may match), not by color alone,
 * and without depending on the style's glyph server. The results list is the keyboard/screen-reader alternative.
 */
export default function MapView({ items, uncertain, center, radiusKm, store, onSearchArea, indexOffset = 1 }: MapViewProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const markersRef = useRef(new Map<string, maplibregl.Marker>());
  const userMarkerRef = useRef<maplibregl.Marker | null>(null);
  const dataRef = useRef<GeoJSON.FeatureCollection<GeoJSON.Point>>({ type: 'FeatureCollection', features: [] });
  const radiusRef = useRef<GeoJSON.Feature | null>(null);
  const [moved, setMoved] = useState(false);
  const [failed, setFailed] = useState(false);
  // The key is folded away by default on phones so it doesn't cover the map; one tap opens it.
  const narrow = useMediaQuery('(max-width: 899px)');
  const [legendOpen, setLegendOpen] = useState<boolean | null>(null);
  const showLegend = legendOpen ?? !narrow;
  const sel = useSelection(store);
  const selRef = useRef(sel.id);
  selRef.current = sel.id;
  const tRef = useRef(t);
  tRef.current = t;

  // ---- create map once ----
  useEffect(() => {
    if (!containerRef.current) return;
    let usedFallback = false;
    let map: MLMap;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: primaryStyleUrl(),
        center: center ? [center.lon, center.lat] : NOVA_CENTER,
        zoom: center ? 12 : 9,
        attributionControl: { compact: false, customAttribution: MAP_ATTRIBUTION },
        cooperativeGestures: false,
        dragRotate: false,
        pitchWithRotate: false,
      });
    } catch {
      setFailed(true); // e.g. WebGL unavailable — the list still works
      return;
    }
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.touchZoomRotate.disableRotation();

    map.on('error', (e) => {
      // Style failed to load (provider down / blocked): switch to raster OSM once.
      if (!usedFallback && !map.isStyleLoaded() && (e as { error?: Error }).error) {
        usedFallback = true;
        map.setStyle(FALLBACK_STYLE);
      }
    });

    const ensureLayers = () => {
      if (!map.getSource(RADIUS_SRC)) {
        map.addSource(RADIUS_SRC, { type: 'geojson', data: radiusRef.current || { type: 'FeatureCollection', features: [] } });
        map.addLayer({ id: 'radius-fill', type: 'fill', source: RADIUS_SRC, paint: { 'fill-color': '#14203f', 'fill-opacity': 0.06 } });
        map.addLayer({
          id: 'radius-line',
          type: 'line',
          source: RADIUS_SRC,
          paint: { 'line-color': '#14203f', 'line-width': 2, 'line-dasharray': [2, 2] },
        });
      }
      if (!map.getSource(SRC)) {
        map.addSource(SRC, { type: 'geojson', data: dataRef.current, cluster: true, clusterRadius: 44, clusterMaxZoom: CLUSTER_MAX_ZOOM });
        // Invisible layer so the source's features are loaded and can be queried for HTML markers.
        map.addLayer({ id: 'resources-anchor', type: 'circle', source: SRC, paint: { 'circle-radius': 1, 'circle-opacity': 0 } });
      }
      renderMarkers();
    };

    const renderMarkers = () => {
      if (!map.getSource(SRC)) return;
      const src = map.getSource(SRC) as GeoJSONSource;
      const features = map.querySourceFeatures(SRC);
      const keep = new Set<string>();
      for (const f of features) {
        const p = f.properties as Record<string, unknown>;
        const coords = (f.geometry as GeoJSON.Point).coordinates as [number, number];
        if (p.cluster) {
          const key = `c${p.cluster_id}`;
          if (keep.has(key)) continue;
          keep.add(key);
          let m = markersRef.current.get(key);
          if (!m) {
            const el = document.createElement('button');
            el.type = 'button';
            el.className = 'mk-cluster';
            el.tabIndex = -1;
            el.setAttribute('aria-hidden', 'true');
            el.textContent = String(p.point_count);
            el.title = tRef.current('map.clusterTitle', { count: Number(p.point_count) });
            el.addEventListener('click', async () => {
              try {
                const zoom = await src.getClusterExpansionZoom(Number(p.cluster_id));
                map.easeTo({ center: coords, zoom: Math.min(zoom + 0.5, 17), animate: !reducedMotion() });
              } catch {
                map.easeTo({ center: coords, zoom: map.getZoom() + 2 });
              }
            });
            m = new maplibregl.Marker({ element: el }).setLngLat(coords).addTo(map);
            markersRef.current.set(key, m);
          }
        } else {
          const id = Number(p.id);
          const key = `p${id}`;
          if (keep.has(key)) continue;
          keep.add(key);
          let m = markersRef.current.get(key);
          const kind = p.kind as Kind;
          if (!m) {
            const el = document.createElement('button');
            el.type = 'button';
            el.className = 'mk-wrap';
            el.tabIndex = -1;
            el.setAttribute('aria-hidden', 'true');
            el.dataset.id = String(id);
            // MapLibre owns the wrapper's transform; the rotated pin lives inside it.
            const pin = document.createElement('span');
            pin.className = `mk mk--${kind}`;
            const label = document.createElement('span');
            label.className = 'mk__label';
            label.textContent = String(p.label);
            pin.appendChild(label);
            el.appendChild(pin);
            // Live pantry status: a distinct badge SHAPE + a short text label under the pin (never colour alone).
            const live = String(p.live || '');
            if (live) {
              el.classList.add(`mk-wrap--live-${live}`);
              const badge = document.createElement('span');
              badge.className = `mk__live mk__live--${live}`;
              badge.textContent = tRef.current(`live.pin.${live}`);
              el.appendChild(badge);
            }
            el.title = `${p.name} — ${tRef.current(kind === 'uncertain' ? 'map.kindUncertain' : kind === 'stale' ? 'verification.stale' : kind === 'reported' ? 'verification.source_reported' : 'verification.verified')}${live ? ` — ${tRef.current(`live.status.${live}`)}` : ''}`;
            el.addEventListener('click', (ev) => {
              ev.stopPropagation();
              store.select(id, 'map');
            });
            m = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat(coords).addTo(map);
            markersRef.current.set(key, m);
          }
          m.getElement().classList.toggle('is-selected', selRef.current === id);
        }
      }
      for (const [key, m] of markersRef.current) {
        if (!keep.has(key)) {
          m.remove();
          markersRef.current.delete(key);
        }
      }
    };

    map.on('style.load', ensureLayers);
    map.on('data', (e) => {
      if ((e as { sourceId?: string }).sourceId === SRC && (e as { isSourceLoaded?: boolean }).isSourceLoaded) renderMarkers();
    });
    map.on('moveend', (e) => {
      renderMarkers();
      if ((e as { originalEvent?: unknown }).originalEvent) setMoved(true);
    });

    const markers = markersRef.current;
    return () => {
      markers.forEach((m) => m.remove());
      markers.clear();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- data updates ----
  useEffect(() => {
    const map = mapRef.current;
    dataRef.current = toGeoJSON(items, uncertain, indexOffset);
    radiusRef.current = center && radiusKm ? circlePolygon(center.lon, center.lat, radiusKm) : null;
    if (!map) return;
    // markers are cached by id; reset so labels/kinds refresh
    markersRef.current.forEach((m) => m.remove());
    markersRef.current.clear();
    const src = map.getSource(SRC) as GeoJSONSource | undefined;
    src?.setData(dataRef.current);
    const rsrc = map.getSource(RADIUS_SRC) as GeoJSONSource | undefined;
    rsrc?.setData(radiusRef.current || { type: 'FeatureCollection', features: [] });

    // user / searched-place marker
    userMarkerRef.current?.remove();
    userMarkerRef.current = null;
    if (center) {
      const el = document.createElement('div');
      el.className = 'mk-user';
      el.setAttribute('aria-hidden', 'true');
      el.title = t('map.youAreHere');
      userMarkerRef.current = new maplibregl.Marker({ element: el }).setLngLat([center.lon, center.lat]).addTo(map);
    }

    // frame the results
    const pts = dataRef.current.features.map((f) => f.geometry.coordinates as [number, number]);
    if (center) pts.push([center.lon, center.lat]);
    const animate = !reducedMotion();
    if (pts.length >= 2) {
      const b = new maplibregl.LngLatBounds(pts[0], pts[0]);
      pts.forEach((p) => b.extend(p));
      map.fitBounds(b, { padding: 56, maxZoom: 14, animate });
    } else if (pts.length === 1) {
      map.easeTo({ center: pts[0], zoom: 13, animate });
    }
    setMoved(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, uncertain, center?.lat, center?.lon, radiusKm, indexOffset]);

  // ---- popup for the selected place (desktop; phones use the bottom "peek" card) ----
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const itemsRef = useRef<ResourceSummary[]>([]);
  itemsRef.current = [...items, ...uncertain];
  useEffect(() => {
    const map = mapRef.current;
    popupRef.current?.remove();
    popupRef.current = null;
    if (!map || sel.id === null || narrow) return;
    const r = itemsRef.current.find((x) => x.id === sel.id);
    if (!r || r.lat == null || r.lon == null) return;
    popupRef.current = new maplibregl.Popup({ offset: 28, closeButton: true, maxWidth: '300px', className: 'map-popup' })
      .setLngLat([r.lon, r.lat])
      .setDOMContent(popupContent(r, tRef.current))
      .addTo(map);
  }, [sel.id, sel.seq, narrow, items, uncertain]);

  // ---- selection from the list: pan + highlight ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach((m, key) => m.getElement().classList.toggle('is-selected', key === `p${sel.id}`));
    if (sel.id === null || sel.origin === 'map') return;
    const f = dataRef.current.features.find((x) => x.properties?.id === sel.id);
    if (!f) return;
    const coords = f.geometry.coordinates as [number, number];
    map.easeTo({ center: coords, zoom: Math.max(map.getZoom(), CLUSTER_MAX_ZOOM + 1), animate: !reducedMotion() });
  }, [sel.id, sel.origin, sel.seq]);

  const searchArea = () => {
    const map = mapRef.current;
    if (!map || !onSearchArea) return;
    const b = map.getBounds();
    onSearchArea([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
    setMoved(false);
  };

  return (
    <div className="map" role="region" aria-label={t('map.label')}>
      <p className="visually-hidden">{t('map.alternative')}</p>
      {failed ? (
        <div className="map__failed">
          <Icon name="map" />
          <p>{t('map.failed')}</p>
        </div>
      ) : (
        <div ref={containerRef} className="map__canvas" data-testid="map-canvas" />
      )}
      {moved && onSearchArea && (
        <button type="button" className="btn btn--primary map__search-area" onClick={searchArea}>
          <Icon name="search" />
          {t('map.searchArea')}
        </button>
      )}
      <div className={`map__legend ${showLegend ? 'is-open' : ''}`}>
        <button type="button" className="map__legend-toggle" aria-expanded={showLegend} aria-controls="map-legend-items" onClick={() => setLegendOpen(!showLegend)}>
          <Icon name={showLegend ? 'chevronDown' : 'chevronUp'} size={16} />
          {t('map.legend')}
        </button>
        <div id="map-legend-items" className="map__legend-items" hidden={!showLegend}>
        <span><span className="mk mk--verified mk--legend" aria-hidden="true"><span className="mk__label">1</span></span>{t('verification.verified')}</span>
        <span><span className="mk mk--stale mk--legend" aria-hidden="true"><span className="mk__label">2</span></span>{t('verification.stale')}</span>
        {items.some((r) => r.verification_label === 'source_reported') && (
          <span><span className="mk mk--reported mk--legend" aria-hidden="true"><span className="mk__label">3</span></span>{t('verification.source_reported')}</span>
        )}
        <span><span className="mk mk--uncertain mk--legend" aria-hidden="true"><span className="mk__label">?</span></span>{t('map.kindUncertain')}</span>
        {items.some((r) => r.live) && (
          <span className="map__legend-live">
            {t('map.livePosted')}:
            {(['open', 'limited', 'out', 'closed'] as const).map((st) => (
              <span key={st} className={`mk__live mk__live--${st} mk__live--legend`}>
                {t(`live.pin.${st}`)}
              </span>
            ))}
          </span>
        )}
        </div>
      </div>
    </div>
  );
}

/** Popup body built with DOM APIs (no HTML strings), so listing text can never inject markup. */
function popupContent(r: ResourceSummary, t: (k: string, o?: Record<string, unknown>) => string): HTMLElement {
  const el = (tag: string, cls?: string, text?: string) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  };
  const root = el('div', 'map-popup__body');
  const title = el('a', 'map-popup__title', r.name) as HTMLAnchorElement;
  title.href = `/resource/${r.id}`;
  root.append(title);
  if (r.organization_name && r.organization_name !== r.name) root.append(el('p', 'map-popup__org', r.organization_name));
  const a = r.address;
  const addr = a ? [a.address1, a.city, a.zip].filter(Boolean).join(', ') : '';
  if (addr) root.append(el('p', 'map-popup__addr', addr));
  const nd = r.next_distribution;
  if (nd) {
    const when = new Date(`${nd.date}T${nd.opens || '00:00'}`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    root.append(el('p', 'map-popup__next', `${t('map.popupNext')}: ${when}${nd.opens ? ` ${nd.opens}${nd.closes ? `–${nd.closes}` : ''}` : ''}`));
  }
  const actions = el('div', 'map-popup__actions');
  const details = el('a', 'btn btn--primary btn--sm', t('map.popupDetails')) as HTMLAnchorElement;
  details.href = `/resource/${r.id}`;
  actions.append(details);
  if (r.lat != null && r.lon != null) {
    const dir = el('a', 'btn btn--secondary btn--sm', t('map.popupDirections')) as HTMLAnchorElement;
    dir.href = `https://www.openstreetmap.org/directions?route=%3B${r.lat}%2C${r.lon}`;
    dir.target = '_blank';
    dir.rel = 'noopener noreferrer';
    actions.append(dir);
  }
  if (r.phone) {
    const call = el('a', 'btn btn--secondary btn--sm', t('map.popupCall')) as HTMLAnchorElement;
    call.href = `tel:${r.phone.replace(/[^\d+]/g, '')}`;
    actions.append(call);
  }
  root.append(actions);
  return root;
}
