import { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { ResourceSummary } from '../api/types';
import { formatAddress, formatDate, formatDistance, formatTimeRange, parseDate, telHref } from '../lib/format';
import { MatchReasons, OperatingBadge, SyntheticBadge, VerificationBadge, WarningList } from './Badges';
import { Icon } from './Icon';

/** "Ticket stub" showing the next distribution date — or a dashed, explicit "schedule not confirmed". */
export function DateStub({ item }: { item: ResourceSummary }) {
  const { i18n } = useTranslation();
  const nd = item.next_distribution;
  if (!nd) {
    return (
      <div className="stub stub--unknown" aria-hidden="true">
        <span className="stub__q">?</span>
      </div>
    );
  }
  const d = parseDate(nd.date);
  const loc = i18n.language === 'es' ? 'es-US' : 'en-US';
  return (
    <div className="stub" aria-hidden="true">
      <span className="stub__month">{new Intl.DateTimeFormat(loc, { month: 'short' }).format(d)}</span>
      <span className="stub__day">{d.getDate()}</span>
      <span className="stub__dow">{new Intl.DateTimeFormat(loc, { weekday: 'short' }).format(d)}</span>
    </div>
  );
}

export function NextDistribution({ item }: { item: ResourceSummary }) {
  const { t, i18n } = useTranslation();
  const nd = item.next_distribution;
  if (nd) {
    return (
      <p className="next">
        <Icon name="calendar" size={16} />
        <span>
          <strong>{t('card.nextDistribution')}</strong>{' '}
          {formatDate(nd.date, i18n.language, { weekday: 'long', month: 'long', day: 'numeric' })}
          {nd.opens && <>, {formatTimeRange(nd.opens, nd.closes, i18n.language)}</>}
          {nd.title && <> — {nd.title}</>}
          {nd.appointment_only && <> · {t('card.appointmentOnly')}</>}
        </span>
      </p>
    );
  }
  return (
    <p className="next next--unknown">
      <Icon name="question" size={16} />
      <span>{item.has_distribution_schedule ? t('card.noUpcoming') : t('card.scheduleUnknown')}</span>
    </p>
  );
}

interface Props {
  item: ResourceSummary;
  index?: number;
  selected: boolean;
  onSelect: (id: number) => void;
  onOpen?: (id: number) => void;
  uncertain?: boolean;
}

export const ResultCard = forwardRef<HTMLLIElement, Props>(function ResultCard({ item, index, selected, onSelect, onOpen, uncertain }, ref) {
  const { t, i18n } = useTranslation();
  const headingId = `res-${item.id}-name`;
  return (
    <li
      ref={ref}
      className={`card ${selected ? 'is-selected' : ''} ${uncertain ? 'card--uncertain' : ''}`}
      data-resource-id={item.id}
      aria-labelledby={headingId}
      aria-current={selected ? 'true' : undefined}
      onClick={(e) => {
        // whole-card click selects on the map, but not when activating an inner control
        if ((e.target as HTMLElement).closest('a,button')) return;
        onSelect(item.id);
      }}
    >
      <DateStub item={item} />
      <div className="card__body">
        <div className="card__badges">
          {item.is_synthetic && <SyntheticBadge />}
          <VerificationBadge label={item.verification_label} lastVerifiedAt={item.last_verified_at} />
          <OperatingBadge status={item.operating_status} />
        </div>
        <h3 id={headingId} className="card__title">
          {index !== undefined && <span className="card__index" aria-hidden="true">{index}</span>}
          <Link to={`/resource/${item.id}`} onClick={(e) => {
            if (onOpen && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
              e.preventDefault();
              onOpen(item.id);
            }
          }}>
            {item.name}
          </Link>
        </h3>
        {item.organization_name && item.organization_name !== item.name && <p className="card__org">{item.organization_name}</p>}
        <p className="card__addr">
          {formatAddress(item.address)}
          {item.distance_km !== null && <span className="card__dist"> · {t('card.away', { distance: formatDistance(item.distance_km, i18n.language) })}</span>}
        </p>
        <NextDistribution item={item} />
        {item.food_groups.length > 0 && (
          <ul className="tags" aria-label={t('card.foodLabel')}>
            {item.food_groups.map((g) => (
              <li key={g}>{t(`foodGroup.${g}`)}</li>
            ))}
          </ul>
        )}
        {uncertain && item.unconfirmed && item.unconfirmed.length > 0 && (
          <div className="unconfirmed">
            <strong>{t('explorer.notConfirmedLabel')}</strong>
            <ul>
              {item.unconfirmed.map((u) => (
                <li key={u}>
                  <Icon name="question" size={13} />
                  {t(`unconfirmed.${u}`, { defaultValue: u })}
                </li>
              ))}
            </ul>
          </div>
        )}
        <MatchReasons reasons={item.match_reasons} />
        <WarningList warnings={item.warnings} />
        <div className="card__actions">
          <Link className="btn btn--secondary btn--sm" to={`/resource/${item.id}`}>
            {t('card.details')}
          </Link>
          {item.lat !== null && item.lon !== null && (
            <button type="button" className="btn btn--ghost btn--sm" aria-pressed={selected} onClick={() => onSelect(item.id)}>
              <Icon name="map" size={16} />
              {t('card.showOnMap')}
            </button>
          )}
          {item.phone && (
            <a className="btn btn--ghost btn--sm" href={telHref(item.phone)}>
              <Icon name="phone" size={16} />
              {t('card.call')}
              <span className="visually-hidden"> {item.name}</span>
            </a>
          )}
        </div>
      </div>
    </li>
  );
});
