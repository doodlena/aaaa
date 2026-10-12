import { useEffect, useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { api } from '../api/client';
import type { GeocodeResult, Jurisdiction } from '../api/types';
import { applyPreferences, DEFAULT_FILTERS, filtersToURL, type Filters } from '../lib/filters';
import { useAuth } from '../state/auth';
import { Icon } from './Icon';
import { errorKey } from './Status';

type Phase = 'idle' | 'geocoding' | 'locating';

/**
 * Address / ZIP search → /api/geocode → navigate to /find?lat&lon&label.
 * Also: "Use my location" (browser geolocation, never sent anywhere except as search coordinates) and county/city browse.
 */
export function SearchForm({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const id = useId();
  const [q, setQ] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [choices, setChoices] = useState<GeocodeResult[]>([]);
  const [jurisdictions, setJurisdictions] = useState<Jurisdiction[]>([]);
  const [jurisdiction, setJurisdiction] = useState('');

  useEffect(() => {
    if (compact) return;
    api
      .jurisdictions()
      .then(setJurisdictions)
      .catch(() => setJurisdictions([]));
  }, [compact]);

  const go = (patch: Partial<Filters>) => {
    const base = applyPreferences({ ...DEFAULT_FILTERS }, user?.preferences);
    navigate(`/find?${filtersToURL({ ...base, ...patch }).toString()}`);
  };

  const pick = (r: GeocodeResult) => go({ lat: r.lat, lon: r.lon, label: r.label });

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const query = q.trim();
    setChoices([]);
    if (query.length < 3) {
      setMessage(t('search.tooShort'));
      return;
    }
    setMessage(null);
    setPhase('geocoding');
    try {
      const res = await api.geocode(query);
      if (!res.results.length) {
        setMessage(res.unavailable_providers.length ? t('search.providersDown') : t('search.noMatch'));
      } else if (res.results.length === 1 || res.results[0].precision === 'zip') {
        pick(res.results[0]);
      } else {
        setChoices(res.results.slice(0, 5));
        setMessage(t('search.chooseOne'));
      }
    } catch (err) {
      setMessage(t(errorKey(err)));
    } finally {
      setPhase('idle');
    }
  };

  const useMyLocation = () => {
    if (!('geolocation' in navigator)) {
      setMessage(t('search.locationUnavailable'));
      return;
    }
    setMessage(null);
    setPhase('locating');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPhase('idle');
        go({ lat: pos.coords.latitude, lon: pos.coords.longitude, label: t('search.myLocation') });
      },
      (err) => {
        setPhase('idle');
        setMessage(err.code === err.PERMISSION_DENIED ? t('search.locationDenied') : t('search.locationUnavailable'));
      },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 },
    );
  };

  return (
    <div className={`search ${compact ? 'search--compact' : ''}`}>
      <form className="search__form" onSubmit={onSubmit} role="search" aria-label={t('search.formLabel')}>
        <label htmlFor={`${id}-q`} className="search__label">
          {t('search.label')}
        </label>
        <p id={`${id}-hint`} className="search__hint">
          {t('search.hint')}
        </p>
        <div className="search__row">
          <input
            id={`${id}-q`}
            name="q"
            type="text"
            inputMode="search"
            autoComplete="postal-code street-address"
            aria-describedby={`${id}-hint ${id}-msg`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('search.placeholder')}
          />
          <button type="submit" className="btn btn--primary btn--lg" disabled={phase !== 'idle'}>
            <Icon name="search" />
            {phase === 'geocoding' ? t('search.searching') : t('search.submit')}
          </button>
        </div>
        <div id={`${id}-msg`} aria-live="polite" className="search__msg">
          {message && <p className="form-msg">{message}</p>}
        </div>
        {choices.length > 0 && (
          <ul className="choices">
            {choices.map((c) => (
              <li key={`${c.lat},${c.lon},${c.label}`}>
                <button type="button" className="btn btn--secondary btn--block" onClick={() => pick(c)}>
                  <Icon name="pin" />
                  {c.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </form>

      {!compact && (
        <div className="search__alt">
          <div className="search__locate">
            <button type="button" className="btn btn--secondary" onClick={useMyLocation} disabled={phase !== 'idle'}>
              <Icon name="locate" />
              {phase === 'locating' ? t('search.locating') : t('search.useLocation')}
            </button>
            <p className="search__hint">{t('search.locationNote')}</p>
          </div>
          {jurisdictions.length > 0 && (
            <form
              className="search__jurisdiction"
              onSubmit={(e) => {
                e.preventDefault();
                if (jurisdiction) go({ jurisdiction });
              }}
            >
              <label htmlFor={`${id}-j`}>{t('search.jurisdictionLabel')}</label>
              <div className="search__row">
                <select id={`${id}-j`} value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)}>
                  <option value="">{t('search.jurisdictionPick')}</option>
                  {jurisdictions.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.name}
                    </option>
                  ))}
                </select>
                <button type="submit" className="btn btn--secondary" disabled={!jurisdiction}>
                  {t('search.browse')}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
