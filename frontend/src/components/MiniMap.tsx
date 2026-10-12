import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FALLBACK_STYLE, MAP_ATTRIBUTION, primaryStyleUrl } from '../lib/mapStyle';

/** Small static-ish map with a single marker (admin coordinate check). */
export default function MiniMap({ lat, lon }: { lat: number; lon: number }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: ref.current,
        style: primaryStyleUrl(),
        center: [lon, lat],
        zoom: 15,
        attributionControl: { compact: true, customAttribution: MAP_ATTRIBUTION },
      });
    } catch {
      setFailed(true);
      return;
    }
    let fell = false;
    map.on('error', () => {
      if (!fell && !map.isStyleLoaded()) {
        fell = true;
        map.setStyle(FALLBACK_STYLE);
      }
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }));
    new maplibregl.Marker({ color: '#14203f' }).setLngLat([lon, lat]).addTo(map);
    return () => map.remove();
  }, [lat, lon]);
  return (
    <div className="minimap" role="img" aria-label={t('admin.coordinatesMap', { lat, lon })}>
      {failed ? <p className="muted">{t('map.failed')}</p> : <div ref={ref} className="minimap__canvas" />}
    </div>
  );
}
