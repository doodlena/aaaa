import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { api } from '../../api/client';
import { SyntheticBadge } from '../../components/Badges';
import { ErrorMessage, Loading } from '../../components/Status';
import { useAsync } from '../../lib/useAsync';
import { StatusPill, When } from './shared';

const STATUSES = ['candidate', 'needs_review', 'on_hold', 'verified', 'stale', 'rejected'] as const;
const PAGE_SIZE = 25;

export function AdminQueue() {
  const { t } = useTranslation();
  const [sp, setSp] = useSearchParams();
  const status = sp.get('status') || '';
  const q = sp.get('q') || '';
  const published = sp.get('published') || '';
  const staleOnly = sp.get('stale_only') === 'true';
  const page = Number(sp.get('page')) || 1;
  const [draft, setDraft] = useState(q);

  const params = {
    status: status || undefined,
    q: q || undefined,
    published: published || undefined,
    stale_only: staleOnly || undefined,
    page,
    page_size: PAGE_SIZE,
  };
  const { data, error, loading, reload } = useAsync(() => api.admin.queue(params), [status, q, published, staleOnly, page]);

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!('page' in patch)) next.delete('page');
    setSp(next);
  };

  const counts = data?.counts_by_status || {};
  const all = Object.values(counts).reduce((a, b) => a + b, 0);
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div>
      <h1>{t('admin.queueTitle')}</h1>
      <div className="tabs" role="group" aria-label={t('admin.statusTabs')}>
        <button type="button" aria-pressed={!status} className="tab" onClick={() => set({ status: null })}>
          {t('admin.all')} <span className="tab__count">{all}</span>
        </button>
        {STATUSES.map((s) => (
          <button key={s} type="button" aria-pressed={status === s} className="tab" onClick={() => set({ status: s })}>
            {t(`reviewStatus.${s}`)} <span className="tab__count">{counts[s] ?? 0}</span>
          </button>
        ))}
      </div>

      <form
        className="admin-filters"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          set({ q: draft.trim() || null });
        }}
      >
        <div className="field field--inline">
          <label htmlFor="aq">{t('admin.search')}</label>
          <input id="aq" type="search" value={draft} onChange={(e) => setDraft(e.target.value)} />
        </div>
        <div className="field field--inline">
          <label htmlFor="apub">{t('admin.published')}</label>
          <select id="apub" value={published} onChange={(e) => set({ published: e.target.value || null })}>
            <option value="">{t('admin.any')}</option>
            <option value="true">{t('admin.yes')}</option>
            <option value="false">{t('admin.no')}</option>
          </select>
        </div>
        <label className="check">
          <input type="checkbox" checked={staleOnly} onChange={(e) => set({ stale_only: e.target.checked ? 'true' : null })} />
          <span>{t('admin.staleOnly')}</span>
        </label>
        <button type="submit" className="btn btn--secondary">
          {t('admin.searchButton')}
        </button>
      </form>

      <div>
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <ErrorMessage error={error} onRetry={reload} />
        ) : data ? (
          <>
            <p role="status" aria-live="polite">
              {t('admin.queueCount', { count: data.total })}
            </p>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">{t('admin.colName')}</th>
                    <th scope="col">{t('admin.colStatus')}</th>
                    <th scope="col">{t('admin.colPublished')}</th>
                    <th scope="col">{t('admin.colSources')}</th>
                    <th scope="col">{t('admin.colPending')}</th>
                    <th scope="col">{t('admin.colLastVerified')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((it) => (
                    <tr key={it.id}>
                      <th scope="row">
                        <Link to={`/admin/resources/${it.id}`}>{it.name}</Link>
                        <div className="muted small">
                          {[it.address1, it.city, it.zip].filter(Boolean).join(', ')}
                          {!it.has_coordinates && <> · {t('admin.noCoordinates')}</>}
                        </div>
                        {it.is_synthetic && <SyntheticBadge />}
                      </th>
                      <td>
                        <StatusPill status={it.review_status} />
                        {it.operating_status !== 'open' && it.operating_status !== 'unknown' && (
                          <div className="small">{t(`operating.${it.operating_status}`)}</div>
                        )}
                      </td>
                      <td>{it.published ? t('admin.yes') : t('admin.no')}</td>
                      <td className="small">{it.sources.join(', ') || '—'}</td>
                      <td>
                        {it.pending_changes > 0 && <div>{t('admin.pendingChanges', { count: it.pending_changes })}</div>}
                        {it.pending_duplicates > 0 && <div>{t('admin.pendingDuplicates', { count: it.pending_duplicates })}</div>}
                        {!!it.open_reports && <div className="queue-reports">{t('admin.openReports', { count: it.open_reports })}</div>}
                        {!it.pending_changes && !it.pending_duplicates && !it.open_reports && '—'}
                      </td>
                      <td>
                        <When at={it.last_verified_at} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pages > 1 && (
              <nav className="pager" aria-label={t('explorer.pagination')}>
                <button type="button" className="btn btn--secondary" disabled={page <= 1} onClick={() => set({ page: String(page - 1) })}>
                  {t('explorer.prev')}
                </button>
                <span>{t('explorer.pageOf', { page, pages })}</span>
                <button type="button" className="btn btn--secondary" disabled={page >= pages} onClick={() => set({ page: String(page + 1) })}>
                  {t('explorer.next')}
                </button>
              </nav>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
