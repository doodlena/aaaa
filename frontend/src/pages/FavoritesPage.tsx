import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate } from 'react-router';
import { api } from '../api/client';
import { SyntheticBadge, VerificationBadge } from '../components/Badges';
import { NextDistribution } from '../components/ResultCard';
import { Empty, ErrorMessage, errorKey, Loading } from '../components/Status';
import { formatAddress, telHref } from '../lib/format';
import { useAsync } from '../lib/useAsync';
import { useAuth } from '../state/auth';
import { warmOfflineCache } from '../lib/offline';

export function FavoritesPage() {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const { data, error, loading, reload } = useAsync(() => (user ? api.favorites() : Promise.resolve({ items: [] })), [user?.id]);
  const [msg, setMsg] = useState<string | null>(null);
  // Keep saved pantries' details + visit cards available offline (the service worker caches these GETs).
  useEffect(() => {
    if (data?.items.length) warmOfflineCache(data.items.filter((f) => f.available).map((f) => f.id));
  }, [data]);

  if (authLoading) return <Loading />;
  if (!user) return <Navigate to="/login?next=/favorites" replace />;

  const remove = async (id: number) => {
    setMsg(null);
    try {
      await api.removeFavorite(id);
      setMsg(t('favorites.removed'));
      reload();
    } catch (e) {
      setMsg(t(errorKey(e)));
    }
  };

  return (
    <div className="page">
      <h1>{t('favorites.title')}</h1>
      <p role="status" className="form-msg">
        {msg}
      </p>
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorMessage error={error} onRetry={reload} />
      ) : !data || data.items.length === 0 ? (
        <Empty title={t('favorites.empty')}>
          <p>{t('favorites.emptyHint')}</p>
          <Link className="btn btn--primary" to="/find">
            {t('nav.find')}
          </Link>
        </Empty>
      ) : (
        <ul className="cards cards--favorites">
          {data.items.map((f) =>
            f.available && f.resource ? (
              <li key={f.id} className="card card--fav">
                <div className="card__body">
                  <div className="card__badges">
                    {f.resource.is_synthetic && <SyntheticBadge />}
                    <VerificationBadge label={f.resource.verification_label} lastVerifiedAt={f.resource.last_verified_at} />
                  </div>
                  <h2 className="card__title">
                    <Link to={`/resource/${f.id}`}>{f.resource.name}</Link>
                  </h2>
                  <p className="card__addr">{formatAddress(f.resource.address)}</p>
                  <NextDistribution item={f.resource} />
                  <div className="card__actions">
                    <Link className="btn btn--secondary btn--sm" to={`/resource/${f.id}`}>
                      {t('card.details')}
                    </Link>
                    {f.resource.phone && (
                      <a className="btn btn--ghost btn--sm" href={telHref(f.resource.phone)}>
                        {t('card.call')}
                      </a>
                    )}
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => void remove(f.id)}>
                      {t('favorites.remove')}
                      <span className="visually-hidden"> {f.resource.name}</span>
                    </button>
                  </div>
                </div>
              </li>
            ) : (
              <li key={f.id} className="card card--fav card--gone">
                <div className="card__body">
                  <h2 className="card__title">{t('favorites.unavailableTitle')}</h2>
                  <p>{t('favorites.unavailable')}</p>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => void remove(f.id)}>
                    {t('favorites.remove')}
                  </button>
                </div>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}
