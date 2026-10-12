import { useTranslation } from 'react-i18next';
import type { MatchReason, Tristate } from '../api/types';
import { formatDate, formatDistance } from '../lib/format';
import { Icon } from './Icon';

/** "Verified" (solid) vs "Needs re-check" (dashed): status is shape + icon + text, never color alone. */
export function VerificationBadge({ label, lastVerifiedAt }: { label: string; lastVerifiedAt?: string | null }) {
  const { t, i18n } = useTranslation();
  const stale = label !== 'verified';
  return (
    <span className={`badge ${stale ? 'badge--unknown' : 'badge--ok'}`} title={lastVerifiedAt ? t('verification.lastVerified', { date: formatDate(lastVerifiedAt, i18n.language, { dateStyle: 'medium' }) }) : undefined}>
      <Icon name={stale ? 'clock' : 'check'} size={14} />
      {t(`verification.${label}`, { defaultValue: t('verification.stale') })}
    </span>
  );
}

export function SyntheticBadge() {
  const { t } = useTranslation();
  return (
    <span className="badge badge--test" data-testid="synthetic-badge">
      <Icon name="flask" size={14} />
      {t('badges.synthetic')}
    </span>
  );
}

export function OperatingBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  if (status !== 'temporarily_closed' && status !== 'permanently_closed') return null;
  return (
    <span className="badge badge--alert">
      <Icon name="alert" size={14} />
      {t(`operating.${status}`)}
    </span>
  );
}

/** Tri-state chip. required = solid filled, not_required = solid outline + check, unknown = dashed + "?". */
export function TriChip({ state, children }: { state: Tristate; children?: React.ReactNode }) {
  const { t } = useTranslation();
  const icon = state === 'required' ? 'alert' : state === 'not_required' ? 'check' : 'question';
  return (
    <span className={`tri tri--${state}`}>
      <Icon name={icon} size={14} />
      <span>{children ?? t(`tristate.${state}`)}</span>
    </span>
  );
}

export function WarningList({ warnings }: { warnings: string[] }) {
  const { t } = useTranslation();
  const shown = warnings.filter((w) => w !== 'synthetic' && w !== 'stale'); // those have dedicated badges
  if (!shown.length) return null;
  return (
    <ul className="warnings" aria-label={t('card.warningsLabel')}>
      {shown.map((w) => (
        <li key={w}>
          <Icon name={w === 'temporarily_closed' ? 'alert' : 'question'} size={14} />
          {t(`warning.${w}`, { defaultValue: w })}
        </li>
      ))}
    </ul>
  );
}

export function matchReasonText(r: MatchReason, t: (k: string, o?: Record<string, unknown>) => string, lang: string): string {
  switch (r.code) {
    case 'distance':
      return t('matchReason.distance', { distance: formatDistance(r.km, lang) });
    case 'food_group':
      return t('matchReason.food_group', { value: t(`foodGroup.${r.value}`) });
    case 'service_group':
      return t('matchReason.service_group', { value: t(`serviceGroup.${r.value}`) });
    case 'distributes_on':
      return t('matchReason.distributes_on', { date: formatDate(r.date, lang, { weekday: 'short', month: 'short', day: 'numeric' }) });
    case 'upcoming':
      return t('matchReason.upcoming', { date: formatDate(r.date, lang, { weekday: 'short', month: 'short', day: 'numeric' }) });
    case 'eligibility_confirmed':
      return t(`eligibilityFilter.${r.value}`);
    default:
      return '';
  }
}

export function MatchReasons({ reasons }: { reasons: MatchReason[] }) {
  const { t, i18n } = useTranslation();
  const shown = reasons.filter((r) => r.code !== 'distance');
  if (!shown.length) return null;
  return (
    <div className="reasons">
      <span className="reasons__label">{t('card.whyShown')}</span>
      <ul>
        {shown.map((r, i) => (
          <li key={i}>
            <Icon name="check" size={13} />
            {matchReasonText(r, t, i18n.language)}
          </li>
        ))}
      </ul>
    </div>
  );
}
