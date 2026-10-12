import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { ErrorMessage, Loading } from '../../components/Status';
import { useAsync } from '../../lib/useAsync';
import { Json, When } from './shared';

export function AdminRuns() {
  const { t } = useTranslation();
  const { data, error, loading, reload } = useAsync(() => api.admin.runs(), []);
  return (
    <div>
      <h1>{t('admin.runsTitle')}</h1>
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorMessage error={error} onRetry={reload} />
      ) : data?.items.length ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">{t('admin.source')}</th>
                <th scope="col">{t('admin.colStatus')}</th>
                <th scope="col">{t('admin.started')}</th>
                <th scope="col">{t('admin.finished')}</th>
                <th scope="col">{t('admin.counts')}</th>
                <th scope="col">{t('admin.errors')}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((r) => (
                <tr key={r.id}>
                  <td>{r.id}</td>
                  <th scope="row">{r.source_id}</th>
                  <td><span className={`pill pill--${r.status}`}>{r.status}</span></td>
                  <td><When at={r.started_at} /></td>
                  <td><When at={r.finished_at} /></td>
                  <td>
                    {r.counts ? (
                      <ul className="plain-list small">
                        {Object.entries(r.counts).map(([k, v]) => (
                          <li key={k}>{k}: {String(v)}</li>
                        ))}
                      </ul>
                    ) : '—'}
                  </td>
                  <td>{r.errors.length ? <details><summary>{r.errors.length}</summary><Json value={r.errors} /></details> : '0'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">{t('admin.noRuns')}</p>
      )}
    </div>
  );
}
