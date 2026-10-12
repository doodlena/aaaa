import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { api } from '../../api/client';
import { ErrorMessage, Loading } from '../../components/Status';
import { useAsync } from '../../lib/useAsync';
import { When } from './shared';

const STATUSES = ['candidate', 'needs_review', 'verified', 'stale', 'rejected'] as const;
const COMPLETENESS = [
  'valid_address_pct',
  'valid_coordinates_pct',
  'with_service_types_pct',
  'with_distribution_schedule_pct',
  'with_documented_eligibility_pct',
  'with_official_website_pct',
  'with_verification_timestamp_pct',
] as const;

/** A bar is decoration only: the number beside it carries the value, so it is hidden from assistive technology. */
function Bar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((100 * value) / max)) : 0;
  return (
    <span className="bar" aria-hidden="true">
      <span className="bar__fill" style={{ width: `${pct}%` }} />
    </span>
  );
}

/** Landing page for reviewers: what is waiting, how complete the listings are, and recent review activity. */
export function AdminOverview() {
  const { t, i18n } = useTranslation();
  const { data, error, loading, reload } = useAsync(async () => {
    const [quality, overview] = await Promise.all([api.admin.quality(), api.admin.overview()]);
    return { quality, overview };
  }, []);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorMessage error={error} onRetry={reload} />;
  if (!data) return null;

  const m = data.quality.metrics;
  const num = (k: string) => (typeof m[k] === 'number' ? (m[k] as number) : 0);
  const pct = (k: string) => (typeof m[k] === 'number' ? (m[k] as number) : null);
  const byStatus = (m.by_review_status && typeof m.by_review_status === 'object' ? m.by_review_status : {}) as Record<string, number>;
  const ov = data.overview;

  const waiting = [
    { key: 'claims', value: ov.pending_claims, to: '/admin/claims' },
    { key: 'unverified', value: (byStatus.candidate ?? 0) + (byStatus.needs_review ?? 0), to: '/admin' },
    { key: 'conflicts', value: num('pending_conflicts') + num('pending_duplicates'), to: '/admin/conflicts' },
    { key: 'reports', value: ov.open_reports, to: '/admin/reports' },
    { key: 'stale', value: num('stale'), to: '/admin?stale_only=true' },
  ];
  const totals = [
    { key: 'listings', value: num('locations_total') },
    { key: 'published', value: num('published') },
    { key: 'organizations', value: num('organizations') },
    { key: 'accounts', value: ov.accounts },
  ];
  const statusMax = Math.max(0, ...STATUSES.map((s) => byStatus[s] ?? 0));
  const weekMax = Math.max(0, ...ov.weeks.map((w) => Math.max(w.verified, w.published)));
  const weekLabel = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString(i18n.language, { month: 'short', day: 'numeric', timeZone: 'UTC' });

  return (
    <div className="overview">
      <h1>{t('admin.overview.title')}</h1>
      <p className="muted">
        {t('admin.generated')}: <When at={ov.generated_at} /> · {t('admin.excludesSynthetic')}
      </p>

      <section aria-labelledby="ov-waiting">
        <h2 id="ov-waiting">{t('admin.overview.waiting')}</h2>
        <ul className="tiles">
          {waiting.map((w) => (
            <li key={w.key}>
              <Link className={`tile tile--link ${w.value > 0 ? 'tile--due' : ''}`} to={w.to}>
                <span className="tile__value">{w.value}</span>
                <span className="tile__label">{t(`admin.overview.${w.key}`)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="ov-totals">
        <h2 id="ov-totals">{t('admin.overview.totals')}</h2>
        <ul className="tiles">
          {totals.map((x) => (
            <li key={x.key}>
              <div className="tile">
                <span className="tile__value">{x.value}</span>
                <span className="tile__label">{t(`admin.overview.${x.key}`)}</span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="ov-status">
        <h2 id="ov-status">{t('admin.metrics.by_review_status')}</h2>
        <div className="table-wrap">
          <table className="table table--bars">
            <tbody>
              {STATUSES.map((s) => (
                <tr key={s}>
                  <th scope="row">{t(`reviewStatus.${s}`)}</th>
                  <td>
                    <Bar value={byStatus[s] ?? 0} max={statusMax} />
                  </td>
                  <td className="table__num">{byStatus[s] ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="ov-complete">
        <h2 id="ov-complete">{t('admin.overview.completeness')}</h2>
        <p className="muted">{t('admin.overview.completenessNote')}</p>
        <div className="table-wrap">
          <table className="table table--bars">
            <tbody>
              {COMPLETENESS.map((k) => {
                const v = pct(k);
                return (
                  <tr key={k}>
                    <th scope="row">{t(`admin.metrics.${k}`)}</th>
                    <td>
                      <Bar value={v ?? 0} max={100} />
                    </td>
                    <td className="table__num">{v === null ? '—' : `${v}%`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p>
          <Link to="/admin/quality">{t('admin.overview.allMetrics')}</Link>
        </p>
      </section>

      <section aria-labelledby="ov-activity">
        <h2 id="ov-activity">{t('admin.overview.activity')}</h2>
        <div className="table-wrap">
          <table className="table table--bars">
            <caption>{t('admin.overview.activityCaption', { count: ov.weeks.length })}</caption>
            <thead>
              <tr>
                <th scope="col">{t('admin.overview.weekOf')}</th>
                <th scope="col" colSpan={2}>{t('admin.overview.verified')}</th>
                <th scope="col" colSpan={2}>{t('admin.overview.publishedCol')}</th>
              </tr>
            </thead>
            <tbody>
              {ov.weeks.map((w) => (
                <tr key={w.week_start}>
                  <th scope="row">
                    <time dateTime={w.week_start}>{weekLabel(w.week_start)}</time>
                  </th>
                  <td>
                    <Bar value={w.verified} max={weekMax} />
                  </td>
                  <td className="table__num">{w.verified}</td>
                  <td>
                    <Bar value={w.published} max={weekMax} />
                  </td>
                  <td className="table__num">{w.published}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
