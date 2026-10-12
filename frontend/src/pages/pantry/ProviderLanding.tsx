import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Icon } from '../../components/Icon';
import { useDocumentTitle } from '../../state/meta';
import { ContactEmail } from './ContactEmail';

const STEPS = ['account', 'request', 'review', 'post'] as const;
const CAN_DO = ['live', 'events', 'closures', 'corrections', 'reports', 'staff', 'surplus'] as const;

/** /pantry for visitors who aren't signed in: what services can do here and how access works. */
export function ProviderLanding() {
  const { t } = useTranslation();
  useDocumentTitle(t('portal.landing.title'));
  const next = encodeURIComponent('/pantry');
  return (
    <div className="page page--wide portal provider-landing">
      <header className="portal__head">
        <p className="eyebrow">{t('portal.eyebrow')}</p>
        <h1 className="display display--sm">{t('portal.landing.title')}</h1>
        <p className="lead">{t('portal.landing.lead')}</p>
        <div className="form__actions">
          <Link className="btn btn--primary" to={`/register?next=${next}`}>
            {t('portal.landing.create')}
          </Link>
          <Link className="btn btn--secondary" to={`/login?next=${next}`}>
            {t('portal.landing.signIn')}
          </Link>
        </div>
      </header>
      <section aria-labelledby="pl-steps">
        <h2 id="pl-steps" className="section-title">
          {t('portal.landing.stepsTitle')}
        </h2>
        <ol className="provider-steps">
          {STEPS.map((k) => (
            <li key={k}>
              <strong>{t(`portal.landing.steps.${k}.title`)}</strong>
              <p className="muted">{t(`portal.landing.steps.${k}.body`)}</p>
            </li>
          ))}
        </ol>
      </section>
      <section aria-labelledby="pl-can">
        <h2 id="pl-can" className="section-title">
          {t('portal.landing.canTitle')}
        </h2>
        <ul className="provider-can">
          {CAN_DO.map((k) => (
            <li key={k}>
              <Icon name="check" size={16} /> {t(`portal.landing.can.${k}`)}
            </li>
          ))}
        </ul>
        <p className="muted">{t('portal.landing.free')}</p>
        <ContactEmail />
      </section>
    </div>
  );
}
