import { useTranslation } from 'react-i18next';
import { ApiError } from '../api/client';
import { Icon } from './Icon';

export function Loading({ label }: { label?: string }) {
  const { t } = useTranslation();
  return (
    <div className="status status--loading" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{label || t('common.loading')}</span>
    </div>
  );
}

export function errorKey(error: unknown): string {
  return error instanceof ApiError ? error.i18nKey : 'errors.server';
}

export function ErrorMessage({ error, onRetry, title }: { error: unknown; onRetry?: () => void; title?: string }) {
  const { t } = useTranslation();
  return (
    <div className="status status--error" role="alert">
      <Icon name="alert" />
      <div>
        {title && <strong className="status__title">{title}</strong>}
        <p>{t(errorKey(error))}</p>
        {onRetry && (
          <button type="button" className="btn btn--secondary" onClick={onRetry}>
            {t('common.retry')}
          </button>
        )}
      </div>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="status status--empty">
      <Icon name="info" />
      <div>
        <strong className="status__title">{title}</strong>
        {children}
      </div>
    </div>
  );
}
