import { useTranslation } from 'react-i18next';
import { Loading } from '../components/Status';
import { formatDate, safeUrl } from '../lib/format';
import { useDocumentTitle, useMeta } from '../state/meta';
import sourceLinks from '../lib/sourceLinks.json';

const PUBLIC_SOURCES: Record<string, { url: string; pages: string[] }> = sourceLinks;

const EXAMPLE_SOURCES = [
  { name: 'Fairfax County — Food Access Resources', url: 'https://www.fairfaxcounty.gov/neighborhood-community-services/food-access' },
  { name: 'Arlington County — Food Resources', url: 'https://my.arlingtonva.us/foodresources' },
  { name: 'Capital Area Food Bank', url: 'https://www.capitalareafoodbank.org/find-food-assistance/' },
  { name: 'Arlington Food Assistance Center', url: 'https://afac.org/get-groceries/' },
];

export function AboutPage() {
  const { t, i18n } = useTranslation();
  const { meta, error, appName } = useMeta();
  useDocumentTitle(t('about.title', { app: appName }));
  return (
    <div className="page page--prose">
      <h1>{t('about.title', { app: appName })}</h1>
      <p className="lead">{t('about.copy.lead', { app: appName })}</p>
      <p>{t('about.copy.goal')}</p>

      <h2 id="ai">{t('about.copy.howTitle', { app: appName })}</h2>
      <p>{t('about.copy.how')}</p>
      <p>{t('about.copy.search')}</p>
      <p>{t('about.copy.providers')}</p>

      <h2>{t('about.copy.accuracyTitle')}</h2>
      <p>{t('about.copy.accuracy')}</p>
      <p>{t('about.copy.contact')}</p>

      <h2 id="privacy">{t('about.copy.privacyTitle')}</h2>
      <p>{t('about.copy.privacyIntro', { app: appName })}</p>
      <ul>
        {['location', 'accounts', 'ads', 'ai'].map((item) => (
          <li key={item}>
            <strong>{t(`about.copy.privacy.${item}.title`)}</strong>{' '}
            {t(`about.copy.privacy.${item}.body`)}
          </li>
        ))}
      </ul>

      <h2>{t('about.copy.sourcesTitle')}</h2>
      <p>{t('about.copy.sourcesIntro', { app: appName })}</p>
      <p>{t('about.copy.examples')}</p>
      <ul className="sources">
        {EXAMPLE_SOURCES.map((s) => (
          <li key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer">{s.name}</a></li>
        ))}
      </ul>
      <p>{t('about.copy.providerSources')}</p>
      <h3>{t('about.copy.allSources')}</h3>
      {meta ? (
        <ul className="sources">
          {meta.sources.map((s) => {
            const publicSource = PUBLIC_SOURCES[s.id];
            const href = safeUrl(s.url) || safeUrl(publicSource?.url);
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
                {!!publicSource?.pages.length && (
                  <details>
                    <summary>{t('about.copy.providerPages')}</summary>
                    <ul>
                      {publicSource.pages.map((url) => (
                        <li key={url}>
                          <a href={url} target="_blank" rel="noopener noreferrer">{url}</a>
                        </li>
                      ))}
                    </ul>
                  </details>
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

      <hr />
      <p><strong>{t('about.copy.reminderTitle')}</strong></p>
      <p>{t('about.copy.reminder', { app: appName })}</p>
      <p>{t('about.copy.help')}</p>
    </div>
  );
}
