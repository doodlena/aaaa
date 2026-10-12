import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { Icon } from '../components/Icon';
import { ResourceDetailView } from '../components/ResourceDetail';
import { NotFoundPage } from './NotFoundPage';

export function ResourcePage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return <NotFoundPage />;
  return (
    <div className="page page--detail">
      <p>
        <Link to="/find" onClick={(e) => {
          if (window.history.length > 1) {
            e.preventDefault();
            window.history.back();
          }
        }}>
          <Icon name="arrowLeft" size={16} /> {t('detail.back')}
        </Link>
      </p>
      <ResourceDetailView id={n} headingLevel={1} />
    </div>
  );
}
