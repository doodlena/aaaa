import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { TriChip } from '../components/Badges';
import { SearchForm } from '../components/SearchForm';

const TYPES = ['pantry', 'meals', 'delivery', 'mobile', 'other'] as const;

export function HomePage() {
  const { t } = useTranslation();
  return (
    <div className="home">
      <section className="hero" aria-labelledby="home-title">
        <div className="hero__inner">
          <h1 id="home-title" className="hero__title">
            {t('home.title')}
          </h1>
          <p className="hero__lead">{t('home.lead')}</p>
          <SearchForm />
        </div>
      </section>

      <section className="page home__types" aria-labelledby="types-title">
        <h2 id="types-title">{t('home.typesTitle')}</h2>
        <ul className="type-grid">
          {TYPES.map((k) => (
            <li key={k} className="type-card">
              <h3>{t(`home.types.${k}.title`)}</h3>
              <p>{t(`home.types.${k}.body`)}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="page home__legend" aria-labelledby="legend-title">
        <h2 id="legend-title">{t('home.legendTitle')}</h2>
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
        <p>
          <Link to="/about">{t('home.learnMore')}</Link>
        </p>
      </section>
    </div>
  );
}
