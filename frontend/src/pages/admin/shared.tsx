import { useTranslation } from 'react-i18next';
import { ApiError } from '../../api/client';
import { formatDateTime } from '../../lib/format';

/** Admin-facing error text: translated summary plus the server's detail (reviewers need the exact reason). */
export function adminError(e: unknown, t: (k: string) => string): string {
  if (e instanceof ApiError) return `${t(e.i18nKey)} ${e.detail && !e.detail.startsWith('HTTP') ? `— ${e.detail}` : ''}`.trim();
  return t('errors.server');
}

export function Json({ value }: { value: unknown }) {
  return <pre className="json">{value === undefined ? '' : JSON.stringify(value, null, 2)}</pre>;
}

export function When({ at }: { at: string | null | undefined }) {
  const { t, i18n } = useTranslation();
  if (!at) return <span className="muted">{t('admin.never')}</span>;
  return <time dateTime={at}>{formatDateTime(at, i18n.language)}</time>;
}

export function StatusPill({ status }: { status: string }) {
  const { t } = useTranslation();
  return <span className={`pill pill--${status}`}>{t(`reviewStatus.${status}`, { defaultValue: status })}</span>;
}

export function renderValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v;
  return JSON.stringify(v, null, 2);
}
