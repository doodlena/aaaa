import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <div className="page page--narrow">
      <h1>{t('notFound.title')}</h1>
      <p>{t('notFound.body')}</p>
      <p>
        <Link className="btn btn--primary" to="/find">
          {t('notFound.cta')}
        </Link>
      </p>
    </div>
  );
}
