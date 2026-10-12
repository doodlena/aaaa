import { useTranslation } from 'react-i18next';
import { ApiError } from '../../api/client';
import { SERVICE_TYPES } from '../../lib/filters';
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

/** Where a change proposal came from. AI ones must be checked against the quoted evidence. */
export function OriginBadge({ origin }: { origin?: string }) {
  const { t } = useTranslation();
  const o = origin || 'import';
  return <span className={`origin origin--${o}`}>{t(`admin.origin.${o}`, { defaultValue: o })}</span>;
}

const serviceLabel = (t: (k: string, o?: Record<string, unknown>) => string, code: string) =>
  `${t(`serviceType.${code}`, { defaultValue: code })} (${t(`serviceGroup.${SERVICE_TYPES[code] || 'other'}`, { defaultValue: SERVICE_TYPES[code] || code })})`;

/** Field name as reviewers read it ("service_types" → "Service categories"). */
export function fieldLabel(field: string, t: (k: string) => string): string {
  return field === 'service_types' ? t('admin.categoryChange.title') : field;
}

/**
 * Current/proposed value of a change proposal. Category changes (field "service_types": current = list of codes,
 * proposed = {add, remove}) are shown as labelled lists; everything else as JSON.
 */
export function ProposalValue({ field, value, proposed = false }: { field: string; value: unknown; proposed?: boolean }) {
  const { t } = useTranslation();
  if (field === 'service_types') {
    const list = (codes: unknown) =>
      Array.isArray(codes) && codes.length ? (
        <ul>
          {codes.map((c: string) => (
            <li key={c}>{serviceLabel(t, c)}</li>
          ))}
        </ul>
      ) : (
        <p className="muted">{t('admin.categoryChange.none')}</p>
      );
    if (!proposed) {
      return (
        <div className="category-change">
          <p className="small muted">{t('admin.categoryChange.current')}</p>
          {list(value)}
        </div>
      );
    }
    const v = (value || {}) as { add?: string[]; remove?: string[] };
    return (
      <div className="category-change category-change--proposed">
        <p className="category-change__add">
          <strong>{t('admin.categoryChange.add')}</strong>
        </p>
        {list(v.add)}
        <p className="category-change__remove">
          <strong>{t('admin.categoryChange.remove')}</strong>
        </p>
        {list(v.remove)}
      </div>
    );
  }
  return <pre className={proposed ? 'json json--proposed' : 'json'}>{renderValue(value)}</pre>;
}
