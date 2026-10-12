import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { SyntheticBadge } from '../../components/Badges';
import { ErrorMessage, Loading } from '../../components/Status';
import { safeUrl } from '../../lib/format';
import { useAsync } from '../../lib/useAsync';
import { When } from './shared';

export function AdminSources() {
  const { t } = useTranslation();
  const { data, error, loading, reload } = useAsync(() => api.admin.sources(), []);
  return (
    <div>
      <h1>{t('admin.sourcesTitle')}</h1>
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorMessage error={error} onRetry={reload} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('admin.source')}</th>
                <th scope="col">{t('admin.adapter')}</th>
                <th scope="col">{t('admin.enabled')}</th>
                <th scope="col">{t('admin.lastSuccess')}</th>
                <th scope="col">{t('admin.lastAttempt')}</th>
                <th scope="col">{t('admin.lastError')}</th>
                <th scope="col">{t('admin.limitations')}</th>
              </tr>
            </thead>
            <tbody>
              {data?.items.map((s) => {
                const href = safeUrl(s.url);
                return (
                  <tr key={s.id}>
                    <th scope="row">
                      {href ? <a href={href} target="_blank" rel="noopener noreferrer">{s.name}</a> : s.name}
                      <div className="small muted">{s.id}{s.owner && ` · ${s.owner}`}</div>
                      {s.jurisdictions?.length ? <div className="small">{s.jurisdictions.join(', ')}</div> : null}
                      {s.is_synthetic && <SyntheticBadge />}
                    </th>
                    <td>{s.adapter}</td>
                    <td>{s.enabled ? t('admin.yes') : t('admin.no')}</td>
                    <td><When at={s.last_success_at} /></td>
                    <td><When at={s.last_attempt_at} /></td>
                    <td className="small">{s.last_error || '—'}</td>
                    <td>
                      {s.known_limitations.length ? (
                        <ul className="plain-list small">{s.known_limitations.map((l, i) => <li key={i}>{l}</li>)}</ul>
                      ) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
