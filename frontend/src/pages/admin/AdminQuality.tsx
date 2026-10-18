import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { ErrorMessage, Loading } from '../../components/Status';
import { useAsync } from '../../lib/useAsync';
import { useMeta } from '../../state/meta';
import { When } from './shared';

/** Data-quality metrics as a plain, accessible table (no charts by design). */
export function AdminQuality() {
  const { t } = useTranslation();
  const demoMode = !!useMeta().features?.demo_mode;
  const { data, error, loading, reload } = useAsync(() => api.admin.quality(), []);
  const fmt = (key: string, v: number | null) => (v === null || v === undefined ? '—' : key.endsWith('_pct') ? `${v}%` : String(v));
  return (
    <div>
      <h1>{t('admin.qualityTitle')}</h1>
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorMessage error={error} onRetry={reload} />
      ) : data ? (
        <>
          <p className="muted">
            {t('admin.generated')}: <When at={data.generated_at} />
            {!demoMode && <> · {data.includes_synthetic ? t('admin.includesSynthetic') : t('admin.excludesSynthetic')}</>}
          </p>
          <div className="table-wrap">
            <table className="table table--metrics">
              <caption>{t('admin.qualityCaption')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('admin.metric')}</th>
                  <th scope="col">{t('admin.value')}</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(data.metrics).flatMap(([k, v]) => {
                  const label = t(`admin.metrics.${k}`, { defaultValue: k });
                  if (v && typeof v === 'object') {
                    const entries = Object.entries(v);
                    return [
                      <tr key={k} className="table__group">
                        <th scope="row">{label}</th>
                        <td>{entries.length ? '' : '—'}</td>
                      </tr>,
                      ...entries.map(([sk, sv]) => (
                        <tr key={`${k}.${sk}`}>
                          <th scope="row" className="table__sub">{sk}</th>
                          <td>{String(sv)}</td>
                        </tr>
                      )),
                    ];
                  }
                  return [
                    <tr key={k}>
                      <th scope="row">{label}</th>
                      <td>{fmt(k, v as number | null)}</td>
                    </tr>,
                  ];
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}
