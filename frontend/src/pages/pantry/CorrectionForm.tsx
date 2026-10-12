import { useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import type { Tristate } from '../../api/types';
import { Icon } from '../../components/Icon';
import { errorKey } from '../../components/Status';
import { SERVICE_GROUPS, SERVICE_TYPES, toggle } from '../../lib/filters';
import { weekdayName } from '../../lib/format';

const REQS = ['photo_id', 'proof_of_address', 'income_documentation', 'residency', 'appointment', 'registration', 'referral'] as const;

/** Service types grouped like the public "What do you need?" groups, in that order. */
const GROUPED_SERVICE_TYPES = SERVICE_GROUPS.map((g) => ({ group: g, types: Object.keys(SERVICE_TYPES).filter((k) => SERVICE_TYPES[k] === g) })).filter(
  (g) => g.types.length > 0,
);

/** Tick the categories offered here. Changes become one reviewed proposal (add/remove), never applied directly. */
function CategoryPicker({ current, selected, onChange }: { current: string[]; selected: string[]; onChange: (next: string[]) => void }) {
  const { t } = useTranslation();
  const id = useId();
  const add = selected.filter((x) => !current.includes(x));
  const remove = current.filter((x) => !selected.includes(x));
  const label = (code: string) => t(`serviceType.${code}`, { defaultValue: code });
  const changes = [
    ...add.map((c) => t('portal.correction.addLabel', { name: label(c) })),
    ...remove.map((c) => t('portal.correction.removeLabel', { name: label(c) })),
  ];
  return (
    <fieldset className="fgroup category-picker" aria-describedby={`${id}-hint`}>
      <legend>{t('portal.correction.categories')}</legend>
      <p id={`${id}-hint`} className="fgroup__hint">
        {t('portal.correction.categoriesHint')}
      </p>
      {GROUPED_SERVICE_TYPES.map((g) => (
        <details key={g.group} className="category-picker__group" open={g.types.some((x) => selected.includes(x) || current.includes(x))}>
          <summary>
            {t(`serviceGroup.${g.group}`, { defaultValue: g.group })}
            {g.types.some((x) => selected.includes(x)) && <span className="muted"> ({g.types.filter((x) => selected.includes(x)).length})</span>}
          </summary>
          <div className="checks checks--cols">
            {g.types.map((code) => (
              <label key={code} className="check check--sm">
                <input type="checkbox" checked={selected.includes(code)} onChange={() => onChange(toggle(selected, code))} />
                <span>{label(code)}</span>
              </label>
            ))}
          </div>
        </details>
      ))}
      <div aria-live="polite">
        {changes.length > 0 && <p className="notice">{t('portal.correction.categoriesPending', { changes: changes.join(', ') })}</p>}
      </div>
    </fieldset>
  );
}

interface HoursRow {
  weekday: number;
  opens: string;
  closes: string;
  appointment_only: boolean;
}

/**
 * Corrections to contact details, hours and requirements. They are PROPOSALS: a reviewer checks them before anything
 * public changes (verified data is never overwritten directly).
 */
export function CorrectionForm({
  locationId,
  food = true,
  serviceTypes,
}: {
  locationId: number;
  /** False for non-food-only listings: hours are opening hours rather than food distribution times. */
  food?: boolean;
  /** Current service categories; when given, the provider can propose adding/removing categories. */
  serviceTypes?: string[];
}) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const [phone, setPhone] = useState('');
  const [website, setWebsite] = useState('');
  const [registration, setRegistration] = useState('');
  const [notes, setNotes] = useState('');
  const [email, setEmail] = useState('');
  const [langs, setLangs] = useState('');
  const [wheelchair, setWheelchair] = useState<'' | 'yes' | 'no' | 'unknown'>('');
  const [access, setAccess] = useState('');
  const [editHours, setEditHours] = useState(false);
  const [hours, setHours] = useState<HoursRow[]>([{ weekday: 5, opens: '09:00', closes: '12:00', appointment_only: false }]);
  const [elig, setElig] = useState<Record<string, Tristate | ''>>({});
  const [categories, setCategories] = useState<string[]>(serviceTypes || []);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const setRow = (i: number, patch: Partial<HoursRow>) => setHours((h) => h.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setOk(null);
    const body: Record<string, unknown> = {};
    if (phone.trim()) body.phone = phone.trim();
    if (website.trim()) body.website = website.trim();
    if (registration.trim()) body.registration_url = registration.trim();
    if (notes.trim()) body.notes = notes.trim();
    if (email.trim()) body.email = email.trim();
    if (langs.trim()) body.languages = langs.split(/[,\s]+/).filter(Boolean);
    if (wheelchair) body.wheelchair_accessible = wheelchair;
    if (access.trim()) body.accessibility_notes = access.trim();
    if (editHours) {
      if (hours.some((h) => !h.opens || !h.closes || h.closes <= h.opens)) {
        setError(t('portal.correction.badHours'));
        return;
      }
      body.schedules = hours.map((h) => ({ kind: food ? 'distribution' : 'operating_hours', ...h }));
    }
    if (serviceTypes) {
      const add = categories.filter((x) => !serviceTypes.includes(x));
      const remove = serviceTypes.filter((x) => !categories.includes(x));
      if (add.length || remove.length) {
        if (!categories.length) {
          setError(t('portal.correction.categoriesEmpty'));
          return;
        }
        if (add.length) body.add_service_types = add;
        if (remove.length) body.remove_service_types = remove;
      }
    }
    const eligList = Object.entries(elig)
      .filter(([, v]) => v)
      .map(([requirement_type, status]) => ({ requirement_type, status }));
    if (eligList.length) body.eligibility = eligList;
    if (!Object.keys(body).length) {
      setError(t('portal.correction.nothing'));
      return;
    }
    if (message.trim()) body.message_to_reviewer = message.trim();
    setBusy(true);
    setError(null);
    try {
      await api.provider.changeRequest(locationId, body);
      setOk(t('portal.correction.sent'));
    } catch (err) {
      setError(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="form" onSubmit={submit} noValidate aria-labelledby={`${id}-t`}>
      <h3 id={`${id}-t`}>{t('portal.correction.title')}</h3>
      <p className="notice">
        <Icon name="info" />
        <span>{t('portal.correction.reviewNote')}</span>
      </p>
      <div className="grid-fields">
        <div className="field">
          <label htmlFor={`${id}-phone`}>{t('detail.phone')}</label>
          <input id={`${id}-phone`} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-web`}>{t('detail.website')}</label>
          <input id={`${id}-web`} type="url" placeholder="https://" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-reg`}>{t('detail.registrationLink')}</label>
          <input id={`${id}-reg`} type="url" placeholder="https://" value={registration} onChange={(e) => setRegistration(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-email`}>{t('portal.correction.email')}</label>
          <input id={`${id}-email`} type="email" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-langs`}>{t('portal.correction.languages')}</label>
          <input id={`${id}-langs`} value={langs} maxLength={120} placeholder="en, es, ko" onChange={(e) => setLangs(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-wc`}>{t('portal.correction.wheelchair')}</label>
          <select id={`${id}-wc`} value={wheelchair} onChange={(e) => setWheelchair(e.target.value as typeof wheelchair)}>
            <option value="">{t('portal.correction.noChange')}</option>
            <option value="yes">{t('portal.correction.yes')}</option>
            <option value="no">{t('portal.correction.no')}</option>
            <option value="unknown">{t('portal.correction.notSure')}</option>
          </select>
        </div>
      </div>
      <div className="field">
        <label htmlFor={`${id}-access`}>{t('portal.correction.accessNotes')}</label>
        <input id={`${id}-access`} value={access} maxLength={1000} onChange={(e) => setAccess(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={`${id}-notes`}>{t('portal.correction.notes')}</label>
        <textarea id={`${id}-notes`} rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      <fieldset className="fgroup">
        <legend>{food ? t('portal.correction.hours') : t('portal.correction.hoursService')}</legend>
        <label className="check">
          <input type="checkbox" checked={editHours} onChange={(e) => setEditHours(e.target.checked)} />
          <span>{t('portal.correction.replaceHours')}</span>
        </label>
        {editHours && (
          <div className="hours-editor">
            {hours.map((h, i) => (
              <div key={i} className="editrow editrow--inline">
                <div className="field">
                  <label htmlFor={`${id}-wd-${i}`}>{t('portal.correction.day')}</label>
                  <select id={`${id}-wd-${i}`} value={h.weekday} onChange={(e) => setRow(i, { weekday: Number(e.target.value) })}>
                    {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                      <option key={d} value={d}>
                        {weekdayName(d, i18n.language)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor={`${id}-op-${i}`}>{t('portal.correction.opens')}</label>
                  <input id={`${id}-op-${i}`} type="time" value={h.opens} onChange={(e) => setRow(i, { opens: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor={`${id}-cl-${i}`}>{t('portal.correction.closes')}</label>
                  <input id={`${id}-cl-${i}`} type="time" value={h.closes} onChange={(e) => setRow(i, { closes: e.target.value })} />
                </div>
                <label className="check check--sm">
                  <input type="checkbox" checked={h.appointment_only} onChange={(e) => setRow(i, { appointment_only: e.target.checked })} />
                  <span>{t('card.appointmentOnly')}</span>
                </label>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => setHours((x) => x.filter((_, j) => j !== i))} disabled={hours.length === 1}>
                  {t('portal.correction.removeRow')}
                </button>
              </div>
            ))}
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={() => setHours((x) => [...x, { weekday: 0, opens: '09:00', closes: '12:00', appointment_only: false }])}
            >
              <Icon name="plus" size={16} />
              {t('portal.correction.addRow')}
            </button>
          </div>
        )}
      </fieldset>

      <fieldset className="fgroup">
        <legend>{t('portal.correction.eligibility')}</legend>
        <p className="fgroup__hint">{t('portal.correction.eligibilityHint')}</p>
        <div className="elig-editor">
          {REQS.map((r) => (
            <div key={r} className="field field--inline">
              <label htmlFor={`${id}-el-${r}`}>{t(`requirement.${r}`)}</label>
              <select id={`${id}-el-${r}`} value={elig[r] || ''} onChange={(e) => setElig((x) => ({ ...x, [r]: e.target.value as Tristate | '' }))}>
                <option value="">{t('portal.correction.noChange')}</option>
                <option value="required">{t('portal.tri.required')}</option>
                <option value="not_required">{t('portal.tri.not_required')}</option>
                <option value="unknown">{t('portal.tri.unknown')}</option>
              </select>
            </div>
          ))}
        </div>
      </fieldset>

      {serviceTypes && <CategoryPicker current={serviceTypes} selected={categories} onChange={setCategories} />}

      <div className="field">
        <label htmlFor={`${id}-msg`}>
          {t('portal.correction.message')} <span className="muted">({t('common.optional')})</span>
        </label>
        <textarea id={`${id}-msg`} rows={2} maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} />
      </div>
      <div aria-live="polite">
        {error && <p className="form-error">{error}</p>}
        {ok && <p className="form-ok">{ok}</p>}
      </div>
      <div className="form__actions">
        <button type="submit" className="btn btn--primary" disabled={busy}>
          {busy ? t('common.sending') : t('portal.correction.send')}
        </button>
      </div>
    </form>
  );
}
