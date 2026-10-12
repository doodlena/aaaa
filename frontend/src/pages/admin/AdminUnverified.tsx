import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { api } from '../../api/client';
import type { QueueItem } from '../../api/types';
import { SyntheticBadge } from '../../components/Badges';
import { ErrorMessage, Loading } from '../../components/Status';
import { useAsync } from '../../lib/useAsync';
import { adminError, StatusPill } from './shared';

const METHODS = ['phone', 'email', 'website', 'in_person', 'official_source', 'provider_submission'] as const;
const PAGE_SIZE = 25;

/**
 * One unverified listing with its own verify form. There is deliberately no "verify all": each verification is one
 * reviewer saying how they checked one listing, and the server refuses a verification without a method.
 */
function UnverifiedRow({ item, onVerified }: { item: QueueItem; onVerified: (text: string) => void }) {
  const { t } = useTranslation();
  const [method, setMethod] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blocked = item.pending_changes > 0;

  const verify = async (publish: boolean) => {
    if (!method) {
      setError(t('admin.methodRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.admin.action(item.id, 'verify', method, notes);
    } catch (e) {
      setError(adminError(e, t));
      setBusy(false);
      return;
    }
    if (!publish) {
      onVerified(t('admin.unverified.done', { name: item.name }));
      return;
    }
    try {
      await api.admin.action(item.id, 'publish', 'none', notes);
      onVerified(t('admin.unverified.donePublished', { name: item.name }));
    } catch (e) {
      // The verification stands; say plainly that the listing is still hidden and why.
      onVerified(t('admin.unverified.verifiedNotPublished', { name: item.name, reason: adminError(e, t) }));
    }
  };

  return (
    <li className="unverified__item">
      <div className="unverified__info">
        <h2 className="unverified__name">
          <Link to={`/admin/resources/${item.id}`}>{item.name}</Link>
        </h2>
        <p className="muted small">{item.organization_name}</p>
        <p>
          <StatusPill status={item.review_status} /> {item.is_synthetic && <SyntheticBadge />}
        </p>
        <dl className="unverified__facts">
          <dt>{t('admin.unverified.address')}</dt>
          <dd>{[item.address1, item.city, item.zip].filter(Boolean).join(', ') || '—'}</dd>
          <dt>{t('admin.unverified.phone')}</dt>
          <dd>{item.phone ? <a href={`tel:${item.phone}`}>{item.phone}</a> : '—'}</dd>
          <dt>{t('admin.unverified.website')}</dt>
          <dd>
            {item.website ? (
              <a href={item.website} target="_blank" rel="noopener noreferrer">
                {item.website}
              </a>
            ) : (
              '—'
            )}
          </dd>
          <dt>{t('admin.colSources')}</dt>
          <dd>{item.sources.join(', ') || '—'}</dd>
        </dl>
        {!item.has_coordinates && <p className="small">{t('admin.noCoordinates')}</p>}
        <p className="small">
          <Link to={`/admin/resources/${item.id}`}>{t('admin.unverified.openFull')}</Link>
        </p>
      </div>
      <div className="unverified__form">
        {blocked ? (
          <p className="small">{t('admin.unverified.blockedChanges', { count: item.pending_changes })}</p>
        ) : (
          <>
            <div className="field">
              <label htmlFor={`um-${item.id}`}>{t('admin.method')}</label>
              <select id={`um-${item.id}`} value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="">{t('admin.methodPick')}</option>
                {METHODS.map((m) => (
                  <option key={m} value={m}>
                    {t(`admin.methods.${m}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor={`un-${item.id}`}>{t('admin.notes')}</label>
              <input id={`un-${item.id}`} type="text" value={notes} maxLength={4000} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <div className="unverified__buttons">
              <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void verify(false)}>
                {t('admin.action.verify')}
              </button>
              <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => void verify(true)}>
                {t('admin.unverified.verifyPublish')}
              </button>
            </div>
          </>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </li>
  );
}

/** Every listing no reviewer has confirmed yet (candidate or needs review), each verified on its own. */
export function AdminUnverified() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [done, setDone] = useState<number[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const { data, error, loading, reload } = useAsync(() => api.admin.queue({ unverified: true, page, page_size: PAGE_SIZE }), [page]);

  const items = data ? data.items.filter((it) => !done.includes(it.id)) : [];
  const total = data ? Math.max(0, data.total - done.length) : 0;
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const go = (p: number) => {
    setDone([]);
    setPage(p);
  };

  return (
    <div className="unverified">
      <h1>{t('admin.unverified.title')}</h1>
      <p>{t('admin.unverified.intro')}</p>
      <div role="status" aria-live="polite">
        {msg && <p className="form-ok">{msg}</p>}
      </div>
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorMessage error={error} onRetry={reload} />
      ) : data ? (
        <>
          <p>{t('admin.unverified.count', { count: total })}</p>
          {items.length > 0 ? (
            <ul className="unverified__list">
              {items.map((it) => (
                <UnverifiedRow
                  key={it.id}
                  item={it}
                  onVerified={(text) => {
                    setMsg(text);
                    setDone((d) => [...d, it.id]);
                  }}
                />
              ))}
            </ul>
          ) : total > 0 ? (
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => {
                setDone([]);
                if (page === 1) reload();
                else setPage(1);
              }}
            >
              {t('admin.unverified.loadMore')}
            </button>
          ) : null}
          {pages > 1 && items.length > 0 && (
            <nav className="pager" aria-label={t('explorer.pagination')}>
              <button type="button" className="btn btn--secondary" disabled={page <= 1} onClick={() => go(page - 1)}>
                {t('explorer.prev')}
              </button>
              <span>{t('explorer.pageOf', { page, pages })}</span>
              <button type="button" className="btn btn--secondary" disabled={page >= pages} onClick={() => go(page + 1)}>
                {t('explorer.next')}
              </button>
            </nav>
          )}
        </>
      ) : null}
    </div>
  );
}
