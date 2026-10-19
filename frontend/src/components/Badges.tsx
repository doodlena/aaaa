import { useTranslation } from 'react-i18next';
import type { MatchReason, Tristate, WhoForItem } from '../api/types';
import { formatDate, formatDistance } from '../lib/format';
import { useMeta } from '../state/meta';
import { Icon } from './Icon';

/**
 * "Verified" (solid) vs "Needs re-check" (dashed) vs "From a public list — not yet verified" (dotted, list icon):
 * status is shape + icon + text, never color alone.
 */
export function VerificationBadge({ label, lastVerifiedAt }: { label: string; lastVerifiedAt?: string | null }) {
  const { t, i18n } = useTranslation();
  const stale = label !== 'verified';
  const reported = label === 'source_reported';
  if (reported) return null; // imported listings show their source in the detail page instead of a "pending" badge
  return (
    <span
      className={`badge ${reported ? 'badge--reported' : stale ? 'badge--unknown' : 'badge--ok'}`}
      data-testid="verification-badge"
      title={lastVerifiedAt ? t('verification.lastVerified', { date: formatDate(lastVerifiedAt, i18n.language, { dateStyle: 'medium' }) }) : undefined}
    >
      <Icon name={reported ? 'list' : stale ? 'clock' : 'check'} size={14} />
      {t(`verification.${label}`, { defaultValue: t('verification.stale') })}
    </span>
  );
}

export function SyntheticBadge() {
  const { t } = useTranslation();
  const { meta, features } = useMeta();
  if (meta?.demo_mode || features?.demo_mode) return null; // demo listings are all fictional; the site banner says so once
  return (
    <span className="badge badge--test" data-testid="synthetic-badge">
      <Icon name="flask" size={14} />
      {t('badges.synthetic')}
    </span>
  );
}

/** "Who can get help here": documented limits on who is served (residents, students, age, referral...). */
export function WhoFor({ items, full }: { items?: WhoForItem[]; full?: boolean }) {
  const { t } = useTranslation();
  if (!items || items.length === 0) return null;
  // A specific group reads as the group itself ("Women only", "Families with children"), not a generic label.
  const label = (i: WhoForItem) =>
    i.type === 'population' && i.groups?.length ? i.groups.map((g) => t(`whoFor.groups.${g}`)).join(', ') : t(`whoFor.${i.type}`);
  if (!full) {
    return (
      <p className="who-for" data-testid="who-for">
        <Icon name="family" size={14} />
        <span className="visually-hidden">{t('whoFor.title')}: </span>
        {items.map(label).join(' · ')}
      </p>
    );
  }
  return (
    <section className="who-for who-for--full" data-testid="who-for" aria-label={t('whoFor.title')}>
      <strong>
        <Icon name="family" size={16} />
        {t('whoFor.title')}
      </strong>
      <ul>
        {items.map((i) => (
          <li key={i.type}>
            <span className="who-for__label">{label(i)}</span>
            {i.details && <span className="who-for__details"> — {i.details}</span>}
          </li>
        ))}
      </ul>
    </section>
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
  const shown = warnings.filter((w) => w !== 'synthetic' && w !== 'stale' && w !== 'not_yet_verified');
  if (!shown.length) return null;
  return (
    <ul className="warnings" aria-label={t('card.warningsLabel')}>
      {shown.map((w) => (
        <li key={w}>
          <Icon name={w === 'temporarily_closed' || w.endsWith('_by_pantry') ? 'alert' : 'question'} size={14} />
          {t(`warning.${w}`, { defaultValue: w })}
        </li>
      ))}
    </ul>
  );
}

function languageName(code: string, lang: string): string {
  try {
    return new Intl.DisplayNames([lang], { type: 'language' }).of(code) || code;
  } catch {
    return code;
  }
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
    case 'on_shelf_today':
      return t('matchReason.on_shelf_today', { value: t(`foodGroup.${r.value}`) });
    case 'open_today_by_pantry':
      return t('matchReason.open_today_by_pantry');
    case 'wheelchair_confirmed':
      return t('matchReason.wheelchair_confirmed');
    case 'language':
      return t('matchReason.language', { value: languageName(r.value, lang) });
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
