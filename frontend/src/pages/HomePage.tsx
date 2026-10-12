import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { AISearch } from '../components/AISearch';
import { TriChip } from '../components/Badges';
import { Icon } from '../components/Icon';
import { NeedsChooser } from '../components/NeedsChooser';
import { SearchForm } from '../components/SearchForm';
import { TodayShelves } from '../components/TodayShelves';
import { useDocumentTitle, useMeta } from '../state/meta';

export function HomePage() {
  const { t } = useTranslation();
  const { appName } = useMeta();
  useDocumentTitle(null, t('app.tagline'));
  return (
    <div className="home">
      <section className="lead-band" aria-labelledby="home-title">
        <div className="lead-band__inner">
          <h1 id="home-title" className="display">
            {t('app.tagline')}
          </h1>
          <p className="lead-band__lede">{t('home.lede', { app: appName })}</p>
          <AISearch hero />
        </div>
        <div className="lead-band__needs">
          <h2 id="needs-title" className="needs__title">
            {t('needs.title')}
          </h2>
          <p className="needs__lead">{t('needs.lead')}</p>
          <NeedsChooser variant="home" headingId="needs-title" />
          <p className="needs__area">
            <Link to="/find" className="area-link">
              <Icon name="map" />
              {t('home.browseAll')}
            </Link>
          </p>
        </div>
      </section>

      <section className="page page--wide home__find" aria-labelledby="find-title">
        <div className="find-panel">
          <h2 id="find-title" className="section-title">
            {t('home.findTitle')}
          </h2>
          <p className="muted">{t('home.findLead')}</p>
          <SearchForm />
        </div>
      </section>

      <section className="page page--wide home__feed" aria-labelledby="feed-title">
        <TodayShelves headingId="feed-title" />
      </section>

      <section className="page page--wide home__legend" aria-labelledby="legend-title">
        <h2 id="legend-title" className="section-title">
          {t('home.legendTitle')}
        </h2>
        <p>{t('home.legendLead')}</p>
        <dl className="legend">
          <div>
            <dt>
              <TriChip state="not_required">{t('tristate.not_required')}</TriChip>
            </dt>
            <dd>{t('home.legend.not_required')}</dd>
          </div>
          <div>
            <dt>
              <TriChip state="required">{t('tristate.required')}</TriChip>
            </dt>
            <dd>{t('home.legend.required')}</dd>
          </div>
          <div>
            <dt>
              <TriChip state="unknown">{t('tristate.unknown')}</TriChip>
            </dt>
            <dd>{t('home.legend.unknown')}</dd>
          </div>
        </dl>
        <p className="muted">{t('home.liveLegend')}</p>
        <p>
          <Link to="/about">{t('home.learnMore')}</Link>
        </p>
      </section>

      <section className="page page--wide" aria-labelledby="pantry-cta-title">
        <div className="pantry-cta">
          <Icon name="store" size={28} />
          <div>
            <h2 id="pantry-cta-title" className="section-title">
              {t('home.pantryTitle')}
            </h2>
            <p>{t('home.pantryBody')}</p>
          </div>
          <Link className="btn btn--talker" to="/pantry">
            {t('nav.forPantries')}
          </Link>
        </div>
      </section>
    </div>
  );
}
