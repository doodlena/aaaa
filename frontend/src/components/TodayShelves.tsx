import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { api } from '../api/client';
import type { LiveStatus, ResourceSummary } from '../api/types';
import { formatAddress, formatDistance, minutesSince } from '../lib/format';
import { useAsync } from '../lib/useAsync';
import { Icon } from './Icon';
import { LiveSummary } from './Live';
import { ErrorMessage, Loading } from './Status';

const ORDER: Record<LiveStatus, number> = { open: 0, limited: 1, out: 2, closed: 3 };
const FEED_RADIUS_KM = 16.09; // 10 miles

interface Place {
  lat: number;
  lon: number;
}

/** Most useful first: open, then limited, out, closed; within a status the freshest post first. */
export function sortFeed(items: ResourceSummary[]): ResourceSummary[] {
  return items
    .filter((r) => r.live)
    .sort((a, b) => ORDER[a.live!.status] - ORDER[b.live!.status] || minutesSince(a.live!.posted_at) - minutesSince(b.live!.posted_at));
}

export function feedQuery(place: Place | null): string {
  const sp = new URLSearchParams();
  if (place) {
    sp.set('lat', String(place.lat));
    sp.set('lon', String(place.lon));
    sp.set('radius_km', String(FEED_RADIUS_KM));
    sp.set('sort', 'distance');
  } else sp.set('sort', 'name');
  sp.set('include_uncertain', 'false');
  sp.set('page_size', '100');
  return sp.toString();
}

/** Home page lead: every pantry post that is live right now, nearest first when the person shares a location. */
export function TodayShelves({ headingId }: { headingId: string }) {
  const { t, i18n } = useTranslation();
  const [place, setPlace] = useState<Place | null>(null);
  const [locMsg, setLocMsg] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const { data, error, loading, reload } = useAsync((signal) => api.search(feedQuery(place), signal), [place?.lat, place?.lon]);
  const feed = data ? sortFeed(data.items) : [];

  const locate = () => {
    if (!('geolocation' in navigator)) {
      setLocMsg(t('search.locationUnavailable'));
      return;
    }
    setLocating(true);
    setLocMsg(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setPlace({ lat: pos.coords.latitude, lon: pos.coords.longitude });
      },
      (err) => {
        setLocating(false);
        setLocMsg(err.code === err.PERMISSION_DENIED ? t('search.locationDenied') : t('search.locationUnavailable'));
      },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 },
    );
  };

  return (
    <div className="feed">
      <div className="feed__bar">
        <h2 id={headingId} className="feed__title">
          {t('feed.title')}
        </h2>
        <p className="feed__scope" aria-live="polite">
          {place ? t('feed.scopeNear') : t('feed.scopeAll')}
        </p>
        {!place && (
          <button type="button" className="btn btn--talker btn--sm" onClick={locate} disabled={locating}>
            <Icon name="locate" size={16} />
            {locating ? t('search.locating') : t('feed.useLocation')}
          </button>
        )}
        {locMsg && <p className="form-msg">{locMsg}</p>}
      </div>
      {loading && !data && <Loading label={t('feed.loading')} />}
      {!!error && <ErrorMessage error={error} onRetry={reload} />}
      {data && feed.length === 0 && (
        <div className="feed__empty">
          <p>
            <strong>{t('feed.emptyTitle')}</strong> {t('feed.emptyBody')}
          </p>
        </div>
      )}
      {feed.length > 0 && (
        <ol className="feed__list" aria-labelledby={headingId}>
          {feed.map((r) => (
            <li key={r.id} className={`unit unit--${r.live!.status}`}>
              <div className="unit__head">
                <h3 className="unit__name">
                  <Link to={`/resource/${r.id}`}>{r.name}</Link>
                </h3>
                <p className="unit__where">
                  {r.address.city || formatAddress(r.address)}
                  {r.distance_km !== null && ` · ${formatDistance(r.distance_km, i18n.language)}`}
                </p>
              </div>
              <LiveSummary live={r.live!} />
            </li>
          ))}
        </ol>
      )}
      <p className="feed__more">
        <Link to="/find?live_open=true&sort=name">{t('feed.seeAllOpen')}</Link>
      </p>
    </div>
  );
}
