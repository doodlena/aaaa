import { CrisisCallout } from './CrisisCallout';
import { offersCrisisServices } from '../lib/filters';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { api } from '../api/client';
import type { ResourceDetail, Schedule, Translation, Tristate } from '../api/types';
import { formatAddress, formatDate, formatDateTime, formatTimeRange, safeUrl, telHref, weekdayName } from '../lib/format';
import { useAsync } from '../lib/useAsync';
import { useAuth } from '../state/auth';
import { useDocumentTitle } from '../state/meta';
import { OperatingBadge, SyntheticBadge, TriChip, VerificationBadge } from './Badges';
import { AIFacts, AIInfoProvider } from './AIInfo';
import { Icon } from './Icon';
import { LiveStatusTag, PostedBy, ReportsNotice, ShelfTags } from './Live';
import { ReportProblem } from './ReportDialog';
import { ErrorMessage, errorKey, Loading } from './Status';
import { VisitPlanner } from './VisitPlanner';

/** Requirements always listed (summary keys from presenter.SUMMARY_ELIGIBILITY); others appear when documented. */
export const CORE_REQUIREMENTS = [
  'photo_id',
  'proof_of_address',
  'income_documentation',
  'residency',
  'appointment',
  'registration',
  'referral',
  'student_affiliation',
] as const;

type Level = 1 | 2;

function H({ level, children, id, className }: { level: number; children: ReactNode; id?: string; className?: string }) {
  const Tag = `h${Math.min(level, 6)}` as 'h1';
  return (
    <Tag id={id} className={className}>
      {children}
    </Tag>
  );
}

/** Shows a machine translation (labelled) when available, with a toggle to the original text. */
export function TranslatableText({ original, translation, as = 'p' }: { original: string | null; translation?: Translation; as?: 'p' | 'span' }) {
  const { t, i18n } = useTranslation();
  const [showOriginal, setShowOriginal] = useState(false);
  if (!original && !translation) return null;
  const Tag = as;
  if (!translation || i18n.language === 'en') return <Tag>{original}</Tag>;
  const flagged = translation.is_machine && !translation.reviewed;
  return (
    <div className="translatable">
      <Tag lang={showOriginal ? undefined : i18n.language}>{showOriginal ? original : translation.text}</Tag>
      {flagged && !showOriginal && (
        <span className="mt-label">
          <Icon name="globe" size={13} />
          {t('detail.machineTranslation')}
        </span>
      )}
      {original && (
        <button type="button" className="linklike mt-toggle" aria-pressed={showOriginal} onClick={() => setShowOriginal((s) => !s)}>
          {showOriginal ? t('detail.showTranslation') : t('detail.showOriginal')}
        </button>
      )}
    </div>
  );
}

function findTranslation(tr: Record<string, Translation>, entity: string, id: number | '*', field: string): Translation | undefined {
  if (id !== '*') return tr[`${entity}:${id}:${field}`];
  const key = Object.keys(tr).find((k) => k.startsWith(`${entity}:`) && k.endsWith(`:${field}`));
  return key ? tr[key] : undefined;
}

export function scheduleRule(s: Schedule, t: (k: string, o?: Record<string, unknown>) => string, lang: string): string {
  if (s.week_of_month === null || s.week_of_month === undefined) return t(`schedule.everyWeekday.${s.weekday}`);
  const day = weekdayName(s.weekday, lang);
  return t(`schedule.weekOfMonth.${s.week_of_month}`, { day });
}

function SaveButton({ id }: { id: number }) {
  const { t } = useTranslation();
  const { user, loading } = useAuth();
  const [saved, setSaved] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    api
      .favorites()
      .then((r) => alive && setSaved(r.items.some((f) => f.id === id)))
      .catch(() => alive && setSaved(false));
    return () => {
      alive = false;
    };
  }, [user, id]);

  if (loading) return null;
  if (!user) {
    return (
      <p className="save-prompt">
        <Icon name="star" size={16} />
        <Link to={`/login?next=${encodeURIComponent(`/resource/${id}`)}`}>{t('detail.signInToSave')}</Link>
        <span className="muted"> {t('detail.signInOptional')}</span>
      </p>
    );
  }
  const toggle = async () => {
    setBusy(true);
    setMsg(null);
    try {
      if (saved) {
        await api.removeFavorite(id);
        setSaved(false);
        setMsg(t('detail.removed'));
      } else {
        await api.addFavorite(id);
        setSaved(true);
        setMsg(t('detail.saved'));
      }
    } catch (e) {
      setMsg(t(errorKey(e)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="save">
      <button type="button" className={`btn ${saved ? 'btn--secondary' : 'btn--ghost'}`} aria-pressed={!!saved} disabled={busy || saved === null} onClick={() => void toggle()}>
        <Icon name="star" />
        {saved ? t('detail.savedButton') : t('detail.save')}
      </button>
      <span role="status" className="save__msg">
        {msg}
      </span>
    </span>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="kv">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Unknown({ children }: { children?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <span className="unknown-text">
      <Icon name="question" size={14} />
      {children ?? t('common.notConfirmed')}
    </span>
  );
}

function YesNo({ value }: { value: string }) {
  const { t } = useTranslation();
  if (value === 'yes') return <TriChip state="not_required">{t('access.yes')}</TriChip>;
  if (value === 'no') return <TriChip state="required">{t('access.no')}</TriChip>;
  return <TriChip state="unknown">{t('tristate.unknown')}</TriChip>;
}

function languageName(code: string, uiLang: string) {
  try {
    const n = new Intl.DisplayNames([uiLang], { type: 'language' }).of(code);
    return n ? n.charAt(0).toUpperCase() + n.slice(1) : code;
  } catch {
    return code;
  }
}

export function ResourceDetailBody({ r, level = 1 }: { r: ResourceDetail; level?: Level }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const h2 = level + 1;
  const h3 = level + 2;
  const website = safeUrl(r.website);
  const registration = safeUrl(r.registration_url);
  const tr = r.translations || {};
  const lastVerified = r.last_verified_at ? formatDate(r.last_verified_at, lang, { year: 'numeric', month: 'long', day: 'numeric' }) : null;

  // Eligibility rows: the 8 core requirements always (unknown stays "Not confirmed"), plus any other documented type.
  const extraTypes = Array.from(new Set(r.eligibility_details.map((e) => e.requirement_type))).filter(
    (x) => !(CORE_REQUIREMENTS as readonly string[]).includes(x),
  );
  const eligRows = [...CORE_REQUIREMENTS, ...extraTypes].map((type) => {
    const details = r.eligibility_details.filter((e) => e.requirement_type === type);
    const state: Tristate =
      (r.eligibility[type] as Tristate | undefined) ??
      (details.some((d) => d.status === 'required') ? 'required' : details.some((d) => d.status === 'not_required') ? 'not_required' : 'unknown');
    return { type, state, details };
  });
  const allUnknown = eligRows.every((e) => e.state === 'unknown');
  const serviceName = (sid: number | null) => {
    const s = r.services.find((x) => x.id === sid);
    return s ? t(`serviceType.${s.service_type}`) : '';
  };

  return (
    <AIInfoProvider id={r.id}>
    <article className="detail" aria-labelledby={`detail-${r.id}-title`}>
      <header className="detail__head">
        <div className="card__badges">
          {r.is_synthetic && <SyntheticBadge />}
          <VerificationBadge label={r.verification_label} lastVerifiedAt={r.last_verified_at} />
          <OperatingBadge status={r.operating_status} />
          {r.live && <LiveStatusTag status={r.live.status} />}
        </div>
        <H level={level} id={`detail-${r.id}-title`} className="detail__title">
          {r.name}
        </H>
        {r.organization_name && r.organization_name !== r.name && <p className="detail__org">{r.organization_name}</p>}
        <p className="detail__addr">
          <Icon name="pin" size={16} />
          {formatAddress(r.address) || <Unknown />}
        </p>
        <div className="detail__actions">
          {r.directions ? (
            <>
              <a className="btn btn--primary" href={r.directions.osm} target="_blank" rel="noopener noreferrer" data-testid="directions-osm">
                <Icon name="route" />
                {t('detail.directions')}
                <span className="visually-hidden"> ({t('detail.opensOsm')})</span>
              </a>
            </>
          ) : (
            <span className="muted">{t('detail.noCoordinates')}</span>
          )}
          {r.phone && (
            <a className="btn btn--secondary" href={telHref(r.phone)}>
              <Icon name="phone" />
              {t('detail.call', { phone: r.phone })}
            </a>
          )}
          <SaveButton id={r.id} />
          <ReportProblem id={r.id} name={r.name} />
        </div>
        <ReportsNotice count={r.open_reports} />
        {offersCrisisServices([...(r.service_types || []), ...r.services.map((x) => x.service_type)]) && <CrisisCallout />}
        {r.directions && (
          <p className="detail__alt-directions">
            {t('detail.otherMaps')}{' '}
            <a href={r.directions.apple} target="_blank" rel="noopener noreferrer">
              Apple Maps
            </a>{' '}
            ·{' '}
            <a href={r.directions.google} target="_blank" rel="noopener noreferrer">
              Google Maps
            </a>
          </p>
        )}
        <GettingThereSection r={r} />
        {r.operating_status === 'temporarily_closed' && <p className="notice notice--alert">{t('detail.temporarilyClosed')}</p>}
        {r.operating_status === 'permanently_closed' && <p className="notice notice--alert">{t('detail.permanentlyClosed')}</p>}
        <p className="notice">
          <Icon name="info" />
          <span>{t('detail.callAhead')}</span>
        </p>
      </header>

      <TodayAtPantry r={r} level={h2} />

      <VisitPlanner r={r} headingLevel={h2} />

      <section className="detail__section" aria-labelledby={`s-basic-${r.id}`}>
        <H level={h2} id={`s-basic-${r.id}`}>
          {t('detail.basicInfo')}
        </H>
        <dl className="kvs">
          <Row label={t('detail.address')}>{formatAddress(r.address) || <Unknown />}</Row>
          <Row label={t('detail.phone')}>{r.phone ? <a href={telHref(r.phone)}>{r.phone}</a> : <Unknown />}</Row>
          {r.email && (
            <Row label={t('detail.email')}>
              <a href={`mailto:${r.email}`}>{r.email}</a>
            </Row>
          )}
          <Row label={t('detail.website')}>
            {website ? (
              <a href={website} target="_blank" rel="noopener noreferrer">
                {website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                <Icon name="external" size={13} />
              </a>
            ) : (
              <Unknown>{t('detail.websiteUnknown')}</Unknown>
            )}
          </Row>
          {registration && (
            <Row label={t('detail.registrationLink')}>
              <a href={registration} target="_blank" rel="noopener noreferrer">
                {t('detail.registerOnline')}
              </a>
            </Row>
          )}
          <Row label={t('detail.organization')}>{r.organization.public_name || r.organization.name}</Row>
        </dl>
        <AIFacts fields={['phone']} confirmed={!!r.phone} />
        {r.organization.description && (
          <TranslatableText original={r.organization.description} translation={findTranslation(tr, 'organization', '*', 'description')} />
        )}
        {r.notes && <TranslatableText original={r.notes} translation={findTranslation(tr, 'location', r.id, 'notes')} />}
      </section>

      <section className="detail__section" aria-labelledby={`s-food-${r.id}`}>
        <H level={h2} id={`s-food-${r.id}`}>
          {t('detail.foodAssistance')}
        </H>
        {r.food_types.length > 0 ? (
          <>
            <p className="muted">{t('detail.typicalOfferings')}</p>
            <ul className="tags">
              {r.food_types.map((f) => (
                <li key={f}>{t(`foodType.${f}`)}</li>
              ))}
            </ul>
          </>
        ) : (
          <p>
            <Unknown>{t('detail.foodTypesUnknown')}</Unknown>
          </p>
        )}
        <ul className="caveats">
          <li>
            <Icon name="info" size={14} />
            {t('detail.selectionVaries')}
          </li>
          <li>
            <Icon name={r.live ? 'store' : 'question'} size={14} />
            {r.live ? t('detail.stockSeeToday') : t('detail.typicalNotToday')}
          </li>
        </ul>
        {r.services.length > 0 && (
          <>
            <H level={h3}>{t('detail.howItWorks')}</H>
            <ul className="services">
              {r.services.map((s) => (
                <li key={s.id} className="service">
                  <p className="service__type">
                    <strong>{t(`serviceType.${s.service_type}`, { defaultValue: s.service_type })}</strong>
                    {s.offering_status !== 'regular' && <span className="tag-inline"> · {t(`offering.${s.offering_status}`)}</span>}
                  </p>
                  {s.description && <TranslatableText original={s.description} translation={findTranslation(tr, 'service', s.id, 'description')} />}
                  <dl className="kvs kvs--compact">
                    <Row label={t('requirement.appointment')}>
                      <TriChip state={s.appointment_required} />
                    </Row>
                    <Row label={t('requirement.registration')}>
                      <TriChip state={s.registration_required} />
                    </Row>
                    {s.frequency && <Row label={t('detail.frequency')}>{s.frequency}</Row>}
                    {s.household_limit && <Row label={t('detail.householdLimit')}>{s.household_limit}</Row>}
                    {s.visit_limit && <Row label={t('detail.visitLimit')}>{s.visit_limit}</Row>}
                  </dl>
                  {s.notes && <TranslatableText original={s.notes} translation={findTranslation(tr, 'service', s.id, 'notes')} />}
                </li>
              ))}
            </ul>
          </>
        )}
        <AIFacts fields={['services']} confirmed={r.services.length > 0 || r.food_types.length > 0} />
      </section>

      <section className="detail__section" aria-labelledby={`s-sched-${r.id}`}>
        <H level={h2} id={`s-sched-${r.id}`}>
          {t('detail.schedule')}
        </H>
        {lastVerified ? (
          <p className="muted">{t('detail.scheduleVerified', { date: lastVerified })}</p>
        ) : (
          <p className="muted">{t('detail.scheduleNeverVerified')}</p>
        )}

        <H level={h3}>{t('detail.distributionTimes')}</H>
        {r.schedules.distribution.length ? (
          <ul className="sched">
            {r.schedules.distribution.map((s, i) => (
              <li key={i}>
                <span className="sched__rule">{scheduleRule(s, t, lang)}</span>
                <span className="sched__time">{formatTimeRange(s.opens, s.closes, lang)}</span>
                {s.appointment_only && <span className="sched__note">{t('card.appointmentOnly')}</span>}
                {s.service_id && r.services.length > 1 && <span className="sched__note">{serviceName(s.service_id)}</span>}
                {(s.valid_from || s.valid_to) && (
                  <span className="sched__note">
                    {t('schedule.validRange', {
                      from: s.valid_from ? formatDate(s.valid_from, lang, { month: 'short', day: 'numeric' }) : '…',
                      to: s.valid_to ? formatDate(s.valid_to, lang, { month: 'short', day: 'numeric' }) : '…',
                    })}
                  </span>
                )}
                {s.notes && <span className="sched__note">{s.notes}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p>
            <Unknown>{r.events.length ? t('detail.onlyEvents') : t('detail.distributionUnknown')}</Unknown>
          </p>
        )}
        <AIFacts fields={['hours', 'dates']} confirmed={r.schedules.distribution.length > 0 || r.upcoming_windows.length > 0} />

        {r.upcoming_windows.length > 0 && (
          <>
            <H level={h3}>{t('detail.upcoming')}</H>
            <ul className="windows">
              {r.upcoming_windows.map((w, i) => (
                <li key={i}>
                  <Icon name="calendar" size={14} />
                  <span>
                    {formatDate(w.date, lang, { weekday: 'long', month: 'long', day: 'numeric' })}
                    {w.opens && `, ${formatTimeRange(w.opens, w.closes, lang)}`}
                    {w.title && ` — ${w.title}`}
                    {w.appointment_only && ` · ${t('card.appointmentOnly')}`}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        {r.events.length > 0 && (
          <>
            <H level={h3}>{t('detail.events')}</H>
            <ul className="events">
              {r.events.map((e) => (
                <li key={e.id} className="event">
                  <strong>{e.title || t('detail.eventUntitled')}</strong>
                  <span>
                    {formatDateTime(e.starts_at, lang)}
                    {e.ends_at && ` – ${formatDateTime(e.ends_at, lang)}`}
                  </span>
                  {e.status && e.status !== 'scheduled' && <span className="badge badge--alert">{t(`eventStatus.${e.status}`, { defaultValue: e.status })}</span>}
                  {e.registration_deadline && (
                    <span className="sched__note">{t('detail.registrationDeadline', { date: formatDateTime(e.registration_deadline, lang) })}</span>
                  )}
                  {e.appointment_required === 'required' && <span className="sched__note">{t('card.appointmentOnly')}</span>}
                  {e.offerings.length > 0 && <span className="sched__note">{e.offerings.map((o) => t(`foodType.${o}`)).join(', ')}</span>}
                  {e.notes && <span className="sched__note">{e.notes}</span>}
                </li>
              ))}
            </ul>
          </>
        )}

        {r.exceptions.length > 0 && (
          <>
            <H level={h3}>{t('detail.closures')}</H>
            <ul className="exceptions">
              {r.exceptions.map((x, i) => (
                <li key={i}>
                  <Icon name="alert" size={14} />
                  <span>
                    {formatDate(x.date, lang)} — {t(`exception.${x.kind}`, { defaultValue: x.kind })}
                    {x.kind === 'special_hours' && x.opens && ` (${formatTimeRange(x.opens, x.closes, lang)})`}
                    {x.reason && `: ${x.reason}`}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        <H level={h3}>{t('detail.officeHours')}</H>
        <p className="muted">{t('detail.officeHoursNote')}</p>
        {r.schedules.operating_hours.length ? (
          <ul className="sched sched--office">
            {r.schedules.operating_hours.map((s, i) => (
              <li key={i}>
                <span className="sched__rule">{scheduleRule(s, t, lang)}</span>
                <span className="sched__time">{formatTimeRange(s.opens, s.closes, lang)}</span>
                {s.notes && <span className="sched__note">{s.notes}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p>
            <Unknown />
          </p>
        )}
      </section>

      <section className="detail__section" aria-labelledby={`s-elig-${r.id}`}>
        <H level={h2} id={`s-elig-${r.id}`}>
          {t('detail.eligibility')}
        </H>
        <p>{t('detail.eligibilityIntro')}</p>
        {allUnknown && (
          <p className="notice notice--unknown">
            <Icon name="question" />
            <span>{t('detail.eligibilityAllUnknown')}</span>
          </p>
        )}
        <table className="elig">
          <caption className="visually-hidden">{t('detail.eligibilityCaption')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('detail.requirement')}</th>
              <th scope="col">{t('detail.status')}</th>
              <th scope="col">{t('detail.details')}</th>
            </tr>
          </thead>
          <tbody>
            {eligRows.map((row) => (
              <tr key={row.type} className={`elig__row elig__row--${row.state}`} data-requirement={row.type}>
                <th scope="row">{t(`requirement.${row.type}`, { defaultValue: row.type })}</th>
                <td>
                  <TriChip state={row.state} />
                </td>
                <td>
                  {row.details
                    .filter((d) => d.details || d.scope === 'service')
                    .map((d, i) => (
                      <p key={i} className="elig__detail">
                        {d.scope === 'service' && d.service_id && <span className="muted">{serviceName(d.service_id)}: </span>}
                        {d.details}
                      </p>
                    ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <AIFacts fields={['eligibility']} confirmed={!allUnknown} />
      </section>

      <section className="detail__section" aria-labelledby={`s-access-${r.id}`}>
        <H level={h2} id={`s-access-${r.id}`}>
          {t('detail.access')}
        </H>
        <dl className="kvs">
          <Row label={t('detail.wheelchair')}>
            <YesNo value={r.accessibility.wheelchair_accessible} />
          </Row>
          <Row label={t('detail.entrance')}>{r.accessibility.entrance || <Unknown />}</Row>
          <Row label={t('detail.parking')}>{r.accessibility.parking || <Unknown />}</Row>
          <Row label={t('detail.transit')}>{r.accessibility.transit || <Unknown />}</Row>
          {r.accessibility.notes && <Row label={t('detail.accessNotes')}>{r.accessibility.notes}</Row>}
          <Row label={t('detail.languages')}>{r.languages.length ? r.languages.map((l) => languageName(l, lang)).join(', ') : <Unknown />}</Row>
        </dl>
        <AIFacts fields={['languages']} confirmed={r.languages.length > 0} />
      </section>

      <section className="detail__section" aria-labelledby={`s-src-${r.id}`}>
        <H level={h2} id={`s-src-${r.id}`}>
          {t('detail.sources')}
        </H>
        <p className="muted">{t('detail.sourcesIntro')}</p>
        {r.sources.length ? (
          <ul className="sources">
            {r.sources.map((s, i) => {
              const href = safeUrl(s.url);
              return (
                <li key={i}>
                  {href ? (
                    <a href={href} target="_blank" rel="noopener noreferrer">
                      {s.name}
                      <Icon name="external" size={13} />
                    </a>
                  ) : (
                    <span>{s.name}</span>
                  )}
                  <span className="muted"> · {t('detail.lastSeen', { date: formatDate(s.last_seen_at, lang, { dateStyle: 'medium' }) })}</span>
                  {s.is_synthetic && <SyntheticBadge />}
                </li>
              );
            })}
          </ul>
        ) : (
          <p>
            <Unknown>{t('detail.noSources')}</Unknown>
          </p>
        )}
        <div className="verif">
          <VerificationBadge label={r.verification_label} lastVerifiedAt={r.last_verified_at} />
          <p>{r.verification_label === 'verified' ? t('detail.verifiedExplain', { date: lastVerified }) : r.verification_label === 'source_reported' ? t('detail.sourceReportedExplain') : t('detail.staleExplain')}</p>
        </div>
      </section>
    </article>
    </AIInfoProvider>
  );
}

/** "Today at this pantry": the pantry's own live post, or an explicit "not confirmed today". */
export function TodayAtPantry({ r, level }: { r: ResourceDetail; level: number }) {
  const { t } = useTranslation();
  const live = r.live;
  const items = r.current_inventory ?? live?.items ?? [];
  return (
    <section className={`detail__section today ${live ? `today--${live.status}` : 'today--none'}`} aria-labelledby={`s-today-${r.id}`} data-testid="today-section">
      <H level={level} id={`s-today-${r.id}`}>
        {t('today.title')}
      </H>
      {live ? (
        <>
          <div className="today__head">
            <LiveStatusTag status={live.status} large />
            <PostedBy live={live} showExpiry />
          </div>
          {live.message && <p className="today__msg">“{live.message}”</p>}
          {items.length > 0 ? (
            <ShelfTags items={items} label={t('today.itemsLabel')} />
          ) : (
            live.status !== 'closed' && <p className="muted">{t('today.noItems')}</p>
          )}
          {(live.status === 'closed' || live.status === 'out') && (
            <p className="notice notice--alert">
              <Icon name="alert" />
              <span>{t(live.status === 'closed' ? 'warning.closed_today_by_pantry' : 'warning.out_today_by_pantry')}</span>
            </p>
          )}
          <p className="fgroup__hint">{t('today.levelsNote')}</p>
        </>
      ) : (
        <p className="notice notice--unknown">
          <Icon name="question" />
          <span>
            <strong>{t('detail.stockNotConfirmed')}</strong> {t('today.notPosted')}
          </span>
        </p>
      )}
    </section>
  );
}

/** Self-loading detail, used by /resource/:id and the explorer side panel. Re-fetches on language change. */
export function ResourceDetailView({ id, headingLevel = 1 }: { id: number; headingLevel?: Level }) {
  const { t, i18n } = useTranslation();
  const { data, error, loading, reload } = useAsync((signal) => api.resource(id, i18n.language, signal), [id, i18n.language]);
  useDocumentTitle(headingLevel === 1 ? (data?.name ?? null) : undefined, t('app.tagline'));
  if (loading && !data) return <Loading label={t('detail.loading')} />;
  if (error) return <ErrorMessage error={error} onRetry={reload} title={t('detail.errorTitle')} />;
  if (!data) return null;
  return <ResourceDetailBody r={data} level={headingLevel} />;
}

/** "Getting there": transit / walking / driving directions, nearest Metro or VRE, nearby bus stops, ride programs. */
function GettingThereSection({ r }: { r: ResourceDetail }) {
  const { t } = useTranslation();
  const d = r.directions;
  const g = r.getting_there;
  if (!d) return null;
  const mi = (km: number) => (km * 0.621371).toFixed(1);
  return (
    <section className="getting-there" aria-labelledby={`gt-${r.id}`}>
      <h2 id={`gt-${r.id}`} className="getting-there__title">
        <Icon name="bus" size={18} /> {t('transit.title')}
      </h2>
      <div className="getting-there__modes">
        {d.google_transit && (
          <a className="btn btn--secondary btn--sm" href={d.google_transit} target="_blank" rel="noopener noreferrer">
            <Icon name="bus" size={16} /> {t('transit.byTransit')}
          </a>
        )}
        {(d.osm_walk || d.google_walk) && (
          <a className="btn btn--secondary btn--sm" href={d.osm_walk || d.google_walk} target="_blank" rel="noopener noreferrer">
            <Icon name="route" size={16} /> {t('transit.walking')}
          </a>
        )}
        <a className="btn btn--secondary btn--sm" href={d.osm} target="_blank" rel="noopener noreferrer">
          <Icon name="pin" size={16} /> {t('transit.driving')}
        </a>
      </div>
      {g && (
        <ul className="getting-there__list">
          {g.rail.map((s) => (
            <li key={`r-${s.name}`}>
              <strong>{s.kind === 'vre' ? t('transit.vre') : t('transit.metro')}:</strong> {s.name}
              {s.lines ? ` (${s.lines})` : ''} · {t('transit.away', { mi: mi(s.distance_km), min: s.walk_minutes })}
            </li>
          ))}
          {g.bus_stops_within_400m > 0 ? (
            <li>
              <strong>{t('transit.bus')}:</strong> {t('transit.busStops', { count: g.bus_stops_within_400m })}
              {g.nearest_bus[0] ? ` — ${t('transit.nearestBus', { name: g.nearest_bus[0].name, min: g.nearest_bus[0].walk_minutes })}` : ''}
            </li>
          ) : (
            <li>{t('transit.noBus')}</li>
          )}
        </ul>
      )}
      <p className="small">
        <Link to="/find?service_group=transportation">{t('transit.needRide')}</Link>
      </p>
      {g && <p className="muted small">{g.attribution}</p>}
    </section>
  );
}
