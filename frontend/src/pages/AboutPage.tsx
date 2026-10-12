import { useTranslation } from 'react-i18next';
import { TriChip } from '../components/Badges';
import { SyntheticBadge, VerificationBadge } from '../components/Badges';
import { Loading } from '../components/Status';
import { formatDate, safeUrl } from '../lib/format';
import { useDocumentTitle, useMeta } from '../state/meta';

export function AboutPage() {
  const { t, i18n } = useTranslation();
  const { meta, error, appName } = useMeta();
  useDocumentTitle(t('about.title', { app: appName }));
  return (
    <div className="page page--prose">
      <h1>{t('about.title', { app: appName })}</h1>
      <p className="lead">{t('about.lead', { app: appName })}</p>

      <h2>{t('about.whatTitle')}</h2>
      <p>{t('about.what')}</p>

      <h2>{t('about.sourcesTitle')}</h2>
      <p>{t('about.sourcesIntro')}</p>
      {meta ? (
        <ul className="sources">
          {meta.sources.map((s) => {
            const href = safeUrl(s.url);
            return (
              <li key={s.id}>
                {href ? (
                  <a href={href} target="_blank" rel="noopener noreferrer">
                    {s.name}
                  </a>
                ) : (
                  <strong>{s.name}</strong>
                )}
                {s.owner && <span className="muted"> — {s.owner}</span>}
                {s.last_success_at && (
                  <span className="muted"> · {t('about.lastUpdated', { date: formatDate(s.last_success_at, i18n.language, { dateStyle: 'medium' }) })}</span>
                )}
              </li>
            );
          })}
        </ul>
      ) : error ? (
        <p className="muted">{t('errors.server')}</p>
      ) : (
        <Loading />
      )}

      <h2>{t('about.labelsTitle')}</h2>
      <dl className="legend legend--wide">
        <div>
          <dt><VerificationBadge label="verified" /></dt>
          <dd>{t('about.labelVerified', { days: meta?.fresh_days ?? 90 })}</dd>
        </div>
        <div>
          <dt><VerificationBadge label="stale" /></dt>
          <dd>{t('about.labelStale')}</dd>
        </div>
        <div>
          <dt><VerificationBadge label="source_reported" /></dt>
          <dd>{t('about.labelReported')}</dd>
        </div>
        <div>
          <dt><TriChip state="not_required" /></dt>
          <dd>{t('home.legend.not_required')}</dd>
        </div>
        <div>
          <dt><TriChip state="required" /></dt>
          <dd>{t('home.legend.required')}</dd>
        </div>
        <div>
          <dt><TriChip state="unknown" /></dt>
          <dd>{t('home.legend.unknown')}</dd>
        </div>
        <div>
          <dt><SyntheticBadge /></dt>
          <dd>{t('about.labelSynthetic')}</dd>
        </div>
      </dl>

      <h2>{t('about.reviewTitle')}</h2>
      <p>{t('about.review', { days: meta?.fresh_days ?? 90 })}</p>

      <h2>{t('about.liveTitle')}</h2>
      <p>{t('about.live')}</p>
      <p>{t('about.reportsInfo')}</p>

      <h2>{t('about.changesTitle')}</h2>
      <p>{t('about.changes')}</p>

      <h2>{t('about.contactTitle')}</h2>
      <p>{t('about.contact')}</p>

      <h2>{t('about.disclaimerTitle')}</h2>
      <p>{t('about.disclaimer')}</p>

      <h2 id="privacy">{t('about.privacyTitle')}</h2>
      <ul className="plain-list">
        <li>{t('about.privacy1')}</li>
        <li>{t('about.privacy2')}</li>
        <li>{t('about.privacy3')}</li>
        <li>{t('about.privacy4')}</li>
        <li>{t('about.privacy5')}</li>
        <li>{t('about.privacy6')}</li>
      </ul>
    </div>
  );
}
