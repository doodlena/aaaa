import { useId, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import type { AnnouncementDraft, Tristate } from '../../api/types';
import { errorKey } from '../../components/Status';
import { groupFoodTypes, toggle } from '../../lib/filters';
import { localInputToISO, todayISO } from '../../lib/format';
import { AIDraftedNotice } from './ShelfForm';

const TRI: Tristate[] = ['unknown', 'required', 'not_required'];

/** One-time event (pop-up distribution, clinic day, legal-aid day…). Public immediately, labelled as posted by the provider. */
export function EventForm({
  locationId,
  foodTypes,
  food = true,
  prefill,
  aiDrafted = false,
  thingsToCheck = [],
}: {
  locationId: number;
  foodTypes?: string[];
  food?: boolean;
  prefill?: AnnouncementDraft['event'] | null;
  aiDrafted?: boolean;
  thingsToCheck?: string[];
}) {
  const { t } = useTranslation();
  const id = useId();
  const [title, setTitle] = useState(prefill?.title || '');
  const [date, setDate] = useState(prefill?.date || '');
  const [start, setStart] = useState(prefill?.start || '');
  const [end, setEnd] = useState(prefill?.end || '');
  const [appt, setAppt] = useState<Tristate>(prefill?.appointment_required || 'unknown');
  const [notes, setNotes] = useState('');
  const [offerings, setOfferings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const groups = useMemo(() => groupFoodTypes(foodTypes), [foodTypes]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setOk(null);
    const startsAt = localInputToISO(date && start ? `${date}T${start}` : '');
    const endsAt = date && end ? localInputToISO(`${date}T${end}`) : null;
    if (title.trim().length < 3 || !startsAt) {
      setError(t('portal.event.missing'));
      return;
    }
    if (endsAt && endsAt <= startsAt) {
      setError(t('portal.event.endBeforeStart'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.provider.postEvent(locationId, {
        title: title.trim(),
        starts_at: startsAt,
        ends_at: endsAt,
        appointment_required: appt,
        notes: notes.trim() || null,
        offerings: food ? offerings : [],
        ai_assisted: aiDrafted,
      });
      setOk(t('portal.event.posted'));
    } catch (err) {
      setError(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={`form ${aiDrafted ? 'is-ai-drafted' : ''}`} onSubmit={submit} noValidate aria-labelledby={`${id}-t`}>
      <h3 id={`${id}-t`}>{food ? t('portal.event.title') : t('portal.event.titleService')}</h3>
      <p className="muted">{food ? t('portal.event.lead') : t('portal.event.leadService')}</p>
      {aiDrafted && <AIDraftedNotice things={thingsToCheck} />}
      <div className="field">
        <label htmlFor={`${id}-title`}>{t('portal.event.name')}</label>
        <input
          id={`${id}-title`}
          value={title}
          maxLength={300}
          placeholder={food ? undefined : t('portal.event.namePlaceholderService')}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="grid-fields">
        <div className="field">
          <label htmlFor={`${id}-date`}>{t('portal.event.date')}</label>
          <input id={`${id}-date`} type="date" min={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-start`}>{t('portal.event.start')}</label>
          <input id={`${id}-start`} type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-end`}>
            {t('portal.event.end')} <span className="muted">({t('common.optional')})</span>
          </label>
          <input id={`${id}-end`} type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-appt`}>{t('portal.event.appointment')}</label>
          <select id={`${id}-appt`} value={appt} onChange={(e) => setAppt(e.target.value as Tristate)}>
            {TRI.map((x) => (
              <option key={x} value={x}>
                {t(`portal.tri.${x}`)}
              </option>
            ))}
          </select>
        </div>
      </div>
      {food && (
      <fieldset className="fgroup">
        <legend>
          {t('portal.event.offerings')} <span className="muted">({t('common.optional')})</span>
        </legend>
        <div className="checks checks--cols">
          {groups.flatMap((g) => g.types).map((code) => (
            <label key={code} className="check check--sm">
              <input type="checkbox" checked={offerings.includes(code)} onChange={() => setOfferings((o) => toggle(o, code))} />
              <span>{t(`foodType.${code}`, { defaultValue: code })}</span>
            </label>
          ))}
        </div>
      </fieldset>
      )}
      <div className="field">
        <label htmlFor={`${id}-notes`}>
          {t('portal.event.notes')} <span className="muted">({t('common.optional')})</span>
        </label>
        <textarea id={`${id}-notes`} rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div aria-live="polite">
        {error && <p className="form-error">{error}</p>}
        {ok && <p className="form-ok">{ok}</p>}
      </div>
      <div className="form__actions">
        <button type="submit" className="btn btn--primary" disabled={busy}>
          {busy ? t('common.sending') : t('portal.event.post')}
        </button>
      </div>
    </form>
  );
}

/** "We're closed on …" — a one-day closure, shown to families right away. */
export function ClosureForm({
  locationId,
  prefill,
  aiDrafted = false,
  thingsToCheck = [],
}: {
  locationId: number;
  prefill?: AnnouncementDraft['closure'] | null;
  aiDrafted?: boolean;
  thingsToCheck?: string[];
}) {
  const { t } = useTranslation();
  const id = useId();
  const [date, setDate] = useState(prefill?.date || '');
  const [reason, setReason] = useState(prefill?.reason || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setOk(null);
    if (!date) {
      setError(t('portal.closure.missing'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.provider.postClosure(locationId, { date, reason: reason.trim() || null });
      setOk(t('portal.closure.posted'));
    } catch (err) {
      setError(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={`form ${aiDrafted ? 'is-ai-drafted' : ''}`} onSubmit={submit} noValidate aria-labelledby={`${id}-t`}>
      <h3 id={`${id}-t`}>{t('portal.closure.title')}</h3>
      {aiDrafted && <AIDraftedNotice things={thingsToCheck} />}
      <div className="grid-fields">
        <div className="field">
          <label htmlFor={`${id}-date`}>{t('portal.closure.date')}</label>
          <input id={`${id}-date`} type="date" min={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="field field--wide">
          <label htmlFor={`${id}-reason`}>
            {t('portal.closure.reason')} <span className="muted">({t('common.optional')})</span>
          </label>
          <input id={`${id}-reason`} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      </div>
      <div aria-live="polite">
        {error && <p className="form-error">{error}</p>}
        {ok && <p className="form-ok">{ok}</p>}
      </div>
      <div className="form__actions">
        <button type="submit" className="btn btn--primary" disabled={busy}>
          {busy ? t('common.sending') : t('portal.closure.post')}
        </button>
      </div>
    </form>
  );
}
