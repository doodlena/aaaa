import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, API_BASE } from '../api/client';
import type { ChecklistAction, ResourceDetail, VisitPlan, Window } from '../api/types';
import { formatAddress, formatDate, formatTimeRange } from '../lib/format';
import { useAsync } from '../lib/useAsync';
import { Icon } from './Icon';
import { ErrorMessage, Loading } from './Status';

/** Steps you *do* rather than documents you *bring*. */
const DO_KEYS = new Set(['appointment', 'registration']);

const ACTION_ICON: Record<ChecklistAction, string> = { bring: 'bag', not_needed: 'check', ask: 'question' };

function actionText(key: string, action: ChecklistAction, t: (k: string) => string): string {
  if (action === 'bring') return DO_KEYS.has(key) ? t('visit.action.do') : t('visit.action.bring');
  if (action === 'not_needed') return t('visit.action.not_needed');
  return t('visit.action.ask'); // unknown is ALWAYS "ask", never "not needed"
}

function WindowLine({ w }: { w: Window }) {
  const { t, i18n } = useTranslation();
  return (
    <>
      {formatDate(w.date, i18n.language, { weekday: 'long', month: 'long', day: 'numeric' })}
      {w.opens && `, ${formatTimeRange(w.opens, w.closes, i18n.language)}`}
      {w.title && ` — ${w.title}`}
      {w.appointment_only && ` · ${t('card.appointmentOnly')}`}
    </>
  );
}

export function Checklist({ plan }: { plan: VisitPlan }) {
  const { t } = useTranslation();
  return (
    <ul className="checklist" aria-label={t('visit.whatToBring')}>
      {plan.checklist.map((c) => (
        <li key={c.key} className={`checklist__item checklist__item--${c.action}`} data-key={c.key} data-action={c.action}>
          <span className="checklist__icon">
            <Icon name={ACTION_ICON[c.action] || 'question'} size={18} />
          </span>
          <span className="checklist__label">{t(`visit.item.${c.key}`, { defaultValue: c.key })}</span>
          <span className="checklist__action">{actionText(c.key, c.action, t)}</span>
        </li>
      ))}
    </ul>
  );
}

function ShareButton({ r }: { r: ResourceDetail }) {
  const { t } = useTranslation();
  const [msg, setMsg] = useState<string | null>(null);
  const url = typeof window !== 'undefined' ? `${window.location.origin}/resource/${r.id}` : `/resource/${r.id}`;
  const share = async () => {
    setMsg(null);
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (typeof nav.share === 'function') {
      try {
        await nav.share({ title: r.name, text: formatAddress(r.address), url });
        return;
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setMsg(t('visit.linkCopied'));
    } catch {
      setMsg(t('visit.copyThis', { url }));
    }
  };
  return (
    <>
      <button type="button" className="btn btn--ghost" onClick={() => void share()}>
        <Icon name="share" />
        {t('visit.share')}
      </button>
      <span role="status" className="save__msg">
        {msg}
      </span>
    </>
  );
}

/** Printable card (hidden on screen; the only thing visible when printing). */
function PrintCard({ r, plan }: { r: ResourceDetail; plan: VisitPlan }) {
  const { t } = useTranslation();
  return (
    <div className="print-card" aria-hidden="true">
      <p className="print-card__brand">{t('visit.cardTitle')}</p>
      <h2>{r.name}</h2>
      <p>{formatAddress(r.address)}</p>
      {r.phone && <p>{t('detail.phone')}: {r.phone}</p>}
      <h3>{t('visit.nextTimes')}</h3>
      {plan.next_windows.length ? (
        <ul>
          {plan.next_windows.map((w, i) => (
            <li key={i}>
              <WindowLine w={w} />
            </li>
          ))}
        </ul>
      ) : (
        <p>{t('visit.noTimes')}</p>
      )}
      <h3>{t('visit.whatToBring')}</h3>
      <ul>
        {plan.checklist.map((c) => (
          <li key={c.key}>
            {c.action === 'bring' ? '☐' : c.action === 'not_needed' ? '✓' : '?'} {t(`visit.item.${c.key}`, { defaultValue: c.key })} —{' '}
            {actionText(c.key, c.action, t)}
          </li>
        ))}
      </ul>
      <p>{t('detail.callAhead')}</p>
    </div>
  );
}

export function VisitPlanner({ r, headingLevel = 2 }: { r: ResourceDetail; headingLevel?: number }) {
  const { t } = useTranslation();
  const { data: plan, error, loading, reload } = useAsync((signal) => api.visitPlan(r.id, signal), [r.id]);
  const H = `h${Math.min(headingLevel, 6)}` as 'h2';
  const H3 = `h${Math.min(headingLevel + 1, 6)}` as 'h3';
  return (
    <section className="detail__section visit" aria-labelledby={`s-visit-${r.id}`} data-testid="visit-planner">
      <H id={`s-visit-${r.id}`}>{t('visit.title')}</H>
      {loading && !plan && <Loading label={t('visit.loading')} />}
      {!!error && <ErrorMessage error={error} onRetry={reload} />}
      {plan && (
        <>
          <H3>{t('visit.nextTimes')}</H3>
          {plan.next_windows.length ? (
            <ul className="windows">
              {plan.next_windows.map((w, i) => (
                <li key={i}>
                  <Icon name="calendar" size={14} />
                  <span>
                    <WindowLine w={w} />
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="unknown-text">
              <Icon name="question" size={14} />
              {t('visit.noTimes')}
            </p>
          )}

          <H3>{t('visit.whatToBring')}</H3>
          <p className="muted">{t('visit.checklistIntro')}</p>
          <Checklist plan={plan} />
          {plan.suggestions.length > 0 && (
            <ul className="suggestions" aria-label={t('visit.suggestionsLabel')}>
              {plan.suggestions.map((s) => (
                <li key={s}>
                  <Icon name={s === 'bags' ? 'bag' : 'phone'} size={15} />
                  {t(`visit.suggestion.${s}`, { defaultValue: s })}
                </li>
              ))}
            </ul>
          )}

          <div className="visit__actions">
            <a className="btn btn--secondary" href={`${API_BASE}/resources/${r.id}/calendar.ics`} download data-testid="calendar-link">
              <Icon name="calendar" />
              {t('visit.addToCalendar')}
            </a>
            <button type="button" className="btn btn--ghost" onClick={() => window.print()}>
              <Icon name="print" />
              {t('visit.print')}
            </button>
            <ShareButton r={r} />
          </div>
          <PrintCard r={r} plan={plan} />
        </>
      )}
    </section>
  );
}
