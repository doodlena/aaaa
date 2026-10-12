import { useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { api } from '../../api/client';
import type { ProviderPantry, ResourceSummary } from '../../api/types';
import { SyntheticBadge } from '../../components/Badges';
import { Icon } from '../../components/Icon';
import { LiveStatusTag, PostedBy } from '../../components/Live';
import { Empty, ErrorMessage, errorKey, Loading } from '../../components/Status';
import { formatAddress } from '../../lib/format';
import { useAsync } from '../../lib/useAsync';
import { useDocumentTitle } from '../../state/meta';

function ClaimForm({ r, onDone, onCancel }: { r: ResourceSummary; onDone: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const id = useId();
  const [role, setRole] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (role.trim().length < 2) {
      setError(t('portal.claim.roleMissing'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.provider.claim(r.id, role.trim(), note);
      onDone();
    } catch (err) {
      setError(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="form claim-form" onSubmit={submit} noValidate>
      <div className="field">
        <label htmlFor={`${id}-role`}>{t('portal.claim.role')}</label>
        <input id={`${id}-role`} value={role} maxLength={120} onChange={(e) => setRole(e.target.value)} placeholder={t('portal.claim.rolePlaceholder')} />
      </div>
      <div className="field">
        <label htmlFor={`${id}-note`}>
          {t('portal.claim.note')} <span className="muted">({t('common.optional')})</span>
        </label>
        <textarea id={`${id}-note`} rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <p className="fgroup__hint">{t('portal.claim.howVerified')}</p>
      <div aria-live="polite">{error && <p className="form-error">{error}</p>}</div>
      <div className="form__actions">
        <button type="submit" className="btn btn--primary btn--sm" disabled={busy}>
          {t('portal.claim.send')}
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}

/** Find your listing near an address/ZIP (same geocoder + search as the public site), then request access. */
function RequestAccess({ mine, onRequested }: { mine: ProviderPantry[]; onRequested: () => void }) {
  const { t } = useTranslation();
  const id = useId();
  const [q, setQ] = useState('');
  const [nameFilter, setNameFilter] = useState('');
  const [results, setResults] = useState<ResourceSummary[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [claiming, setClaiming] = useState<number | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const find = async (e: FormEvent) => {
    e.preventDefault();
    if (q.trim().length < 3) {
      setMsg(t('search.tooShort'));
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const geo = await api.geocode(q.trim());
      const place = geo.results[0];
      if (!place) {
        setMsg(t('search.noMatch'));
        setResults(null);
        return;
      }
      const res = await api.search(`lat=${place.lat}&lon=${place.lon}&radius_km=16.09&sort=distance&include_uncertain=false&page_size=50`);
      setResults(res.items);
    } catch (err) {
      setMsg(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  const shown = (results || []).filter((r) => !nameFilter.trim() || r.name.toLowerCase().includes(nameFilter.trim().toLowerCase()));
  const already = new Set(mine.map((m) => m.location_id));

  return (
    <section className="card-section" aria-labelledby={`${id}-t`}>
      <h2 id={`${id}-t`} className="section-title">
        {t('portal.claim.title')}
      </h2>
      <p>{t('portal.claim.lead')}</p>
      <form className="search__form" onSubmit={find} role="search" aria-label={t('portal.claim.findLabel')}>
        <label htmlFor={`${id}-q`}>{t('portal.claim.findLabel')}</label>
        <div className="search__row">
          <input id={`${id}-q`} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search.placeholder')} />
          <button type="submit" className="btn btn--secondary" disabled={busy}>
            <Icon name="search" />
            {t('portal.claim.find')}
          </button>
        </div>
      </form>
      <div aria-live="polite">
        {msg && <p className="form-msg">{msg}</p>}
        {sent && <p className="form-ok">{sent}</p>}
      </div>
      {results && (
        <>
          <div className="field">
            <label htmlFor={`${id}-name`}>{t('portal.claim.filterName')}</label>
            <input id={`${id}-name`} value={nameFilter} onChange={(e) => setNameFilter(e.target.value)} />
          </div>
          {shown.length === 0 ? (
            <Empty title={t('portal.claim.noneFound')} />
          ) : (
            <ul className="claim-list" aria-label={t('portal.claim.resultsLabel')}>
              {shown.map((r) => (
                <li key={r.id}>
                  <div>
                    <strong>{r.name}</strong> {r.is_synthetic && <SyntheticBadge />}
                    <p className="muted">{formatAddress(r.address)}</p>
                  </div>
                  {already.has(r.id) ? (
                    <span className="muted">{t('portal.claim.alreadyRequested')}</span>
                  ) : claiming === r.id ? (
                    <ClaimForm
                      r={r}
                      onCancel={() => setClaiming(null)}
                      onDone={() => {
                        setClaiming(null);
                        setSent(t('portal.claim.sent', { name: r.name }));
                        onRequested();
                      }}
                    />
                  ) : (
                    <button type="button" className="btn btn--secondary btn--sm" onClick={() => setClaiming(r.id)}>
                      {t('portal.claim.request')}
                      <span className="visually-hidden"> — {r.name}</span>
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

export function PantryHome() {
  const { t } = useTranslation();
  useDocumentTitle(t('portal.title'));
  const me = useAsync(() => api.provider.me(), []);
  const items = me.data?.items || [];
  const approved = items.filter((x) => x.status === 'approved');
  const other = items.filter((x) => x.status !== 'approved');
  return (
    <div className="page page--wide portal">
      <header className="portal__head">
        <p className="eyebrow">{t('portal.eyebrow')}</p>
        <h1 className="display display--sm">{t('portal.title')}</h1>
        <p className="lead">{t('portal.lead')}</p>
      </header>
      {me.loading && !me.data && <Loading />}
      {!!me.error && <ErrorMessage error={me.error} onRetry={me.reload} />}
      {me.data && (
        <>
          {approved.length > 0 && (
            <section aria-labelledby="my-pantries">
              <h2 id="my-pantries" className="section-title">
                {t('portal.myPantries')}
              </h2>
              <ul className="pantry-list">
                {approved.map((p) => (
                  <li key={p.location_id} className="pantry-tile">
                    <h3>
                      <Link to={`/pantry/${p.location_id}`}>{p.name}</Link>
                    </h3>
                    <p className="muted">{[p.address1, p.city].filter(Boolean).join(', ')}</p>
                    {p.live ? (
                      <div className="pantry-tile__live">
                        <LiveStatusTag status={p.live.status} />
                        <PostedBy live={p.live} />
                      </div>
                    ) : (
                      <p className="unknown-text">
                        <Icon name="question" size={14} />
                        {t('portal.current.none')}
                      </p>
                    )}
                    <p className="pantry-tile__meta">
                      {t('portal.openReports', { count: p.open_reports || 0 })} · {t('portal.pendingChanges', { count: p.pending_changes || 0 })}
                    </p>
                    <Link className="btn btn--primary btn--sm" to={`/pantry/${p.location_id}`}>
                      {t('portal.manage')}
                      <span className="visually-hidden"> — {p.name}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              <p>
                <Link to="/pantry/surplus">
                  <Icon name="truck" size={16} /> {t('portal.surplusLink')}
                </Link>
              </p>
            </section>
          )}
          {other.length > 0 && (
            <section aria-labelledby="my-requests">
              <h2 id="my-requests" className="section-title">
                {t('portal.myRequests')}
              </h2>
              <ul className="plain-list request-list">
                {other.map((p) => (
                  <li key={p.membership_id}>
                    <strong>{p.name}</strong> — <span className={`pill pill--${p.status}`}>{t(`portal.claimStatus.${p.status}`, { defaultValue: p.status })}</span>
                    {p.status === 'pending' && <span className="muted"> {t('portal.pendingHint')}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {approved.length === 0 && other.length === 0 && <p>{t('portal.noneYet')}</p>}
          <RequestAccess mine={items} onRequested={me.reload} />
        </>
      )}
    </div>
  );
}
