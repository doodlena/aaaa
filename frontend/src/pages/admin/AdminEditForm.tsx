import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import type { ReviewDetail } from '../../api/types';
import { weekdayName } from '../../lib/format';
import { adminError } from './shared';

const SERVICE_TYPES = [
  'pantry_pickup', 'walk_up', 'drive_through', 'mobile_pantry', 'community_meal', 'home_delivery', 'delivery_qualifying', 'emergency_food',
  'school_based', 'appointment_distribution', 'seasonal_program', 'grocery_voucher', 'diapers', 'hygiene_supplies', 'household_essentials',
  'food_referral', 'other',
];
const FOOD_TYPES = [
  'general_groceries', 'pantry_staples', 'fresh_fruits', 'fresh_vegetables', 'meat', 'poultry', 'fish', 'dairy', 'eggs', 'frozen_foods', 'bread',
  'baked_goods', 'prepared_meals', 'community_meals', 'emergency_food_packages', 'baby_formula', 'infant_food', 'culturally_specific',
  'vegetarian', 'halal', 'kosher', 'other_special_diet',
];
const ELIGIBILITY_TYPES = [
  'residency', 'service_area', 'zip_restriction', 'income', 'household_size', 'age', 'student_affiliation', 'referral', 'registration',
  'appointment', 'photo_id', 'proof_of_address', 'income_documentation', 'benefit_documentation', 'visit_limit', 'quantity_limit',
  'first_come_first_served', 'other',
];
const TRI = ['unknown', 'required', 'not_required'];
const OFFERING = ['regular', 'seasonal', 'event_specific', 'unconfirmed'];

const CORE = [
  'name', 'organization_name', 'organization_website', 'address1', 'address2', 'city', 'zip', 'lat', 'lon', 'jurisdiction_id', 'phone', 'email',
  'website', 'registration_url', 'operating_status', 'wheelchair_accessible', 'accessibility_notes', 'parking_notes', 'transit_notes',
  'entrance_notes', 'languages', 'notes',
] as const;
type CoreKey = (typeof CORE)[number];

interface SvcRow {
  service_type: string;
  description: string;
  offering_status: string;
  frequency: string;
  appointment_required: string;
  registration_required: string;
  household_limit: string;
  visit_limit: string;
  notes: string;
  food_types: string[];
}
interface SchedRow {
  kind: string;
  weekday: number;
  opens: string;
  closes: string;
  week_of_month: string;
  appointment_only: boolean;
  notes: string;
  service_index: string;
}
interface EligRow {
  requirement_type: string;
  status: string;
  details: string;
  values: Record<string, unknown>;
  service_index: string;
}

function initialCore(r: ReviewDetail): Record<CoreKey, string> {
  return {
    name: r.name ?? '',
    organization_name: r.organization.name ?? '',
    organization_website: r.organization.website ?? '',
    address1: r.address.address1 ?? '',
    address2: r.address.address2 ?? '',
    city: r.address.city ?? '',
    zip: r.address.zip ?? '',
    lat: r.lat === null ? '' : String(r.lat),
    lon: r.lon === null ? '' : String(r.lon),
    jurisdiction_id: r.jurisdiction_id ?? '',
    phone: r.phone ?? '',
    email: r.email ?? '',
    website: r.location_website ?? '',
    registration_url: r.registration_url ?? '',
    operating_status: r.operating_status ?? 'unknown',
    wheelchair_accessible: r.accessibility.wheelchair_accessible ?? 'unknown',
    accessibility_notes: r.accessibility.notes ?? '',
    parking_notes: r.accessibility.parking ?? '',
    transit_notes: r.accessibility.transit ?? '',
    entrance_notes: r.accessibility.entrance ?? '',
    languages: (r.languages || []).join(', '),
    notes: r.notes ?? '',
  };
}

const idxOf = (r: ReviewDetail, sid: number | null) => {
  const i = r.services.findIndex((s) => s.id === sid);
  return i >= 0 ? String(i) : '';
};

/** Partial edit form. Core fields are sent only when changed; nested lists are sent (and replace the set) only when edited. */
export function AdminEditForm({ r, onSaved, onCancel }: { r: ReviewDetail; onSaved: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const [core, setCore] = useState(() => initialCore(r));
  const [orig] = useState(() => initialCore(r));
  const [services, setServices] = useState<SvcRow[]>(() =>
    r.services.map((s) => ({
      service_type: s.service_type,
      description: s.description ?? '',
      offering_status: s.offering_status,
      frequency: s.frequency ?? '',
      appointment_required: s.appointment_required,
      registration_required: s.registration_required,
      household_limit: s.household_limit ?? '',
      visit_limit: s.visit_limit ?? '',
      notes: s.notes ?? '',
      food_types: s.food_types,
    })),
  );
  const [schedules, setSchedules] = useState<SchedRow[]>(() =>
    [
      ...r.schedules.distribution.map((s) => ({ ...s, kind: 'distribution' })),
      ...r.schedules.operating_hours.map((s) => ({ ...s, kind: 'operating_hours' })),
    ].map((s) => ({
      kind: s.kind,
      weekday: s.weekday,
      opens: s.opens,
      closes: s.closes,
      week_of_month: s.week_of_month === null ? '' : String(s.week_of_month),
      appointment_only: s.appointment_only,
      notes: s.notes ?? '',
      service_index: idxOf(r, s.service_id),
    })),
  );
  const [elig, setElig] = useState<EligRow[]>(() =>
    r.eligibility_details.map((e) => ({
      requirement_type: e.requirement_type,
      status: e.status,
      details: e.details ?? '',
      values: e.values || {},
      service_index: idxOf(r, e.service_id),
    })),
  );
  const [dirty, setDirty] = useState({ services: false, schedules: false, eligibility: false });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const nul = (s: string) => (s.trim() === '' ? null : s.trim());

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    const body: Record<string, unknown> = {};
    for (const k of CORE) {
      if (core[k] === orig[k]) continue;
      if (k === 'lat' || k === 'lon') body[k] = core[k] === '' ? null : Number(core[k]);
      else if (k === 'languages') body[k] = core[k].split(',').map((x) => x.trim()).filter(Boolean);
      else body[k] = nul(core[k]);
    }
    if (dirty.services) {
      body.services = services.map((s) => ({
        ...s,
        description: nul(s.description),
        frequency: nul(s.frequency),
        household_limit: nul(s.household_limit),
        visit_limit: nul(s.visit_limit),
        notes: nul(s.notes),
      }));
    }
    if (dirty.schedules) {
      body.schedules = schedules.map((s) => ({
        kind: s.kind,
        weekday: Number(s.weekday),
        opens: s.opens,
        closes: s.closes,
        week_of_month: s.week_of_month === '' ? null : Number(s.week_of_month),
        appointment_only: s.appointment_only,
        notes: nul(s.notes),
        service_index: s.service_index === '' ? null : Number(s.service_index),
      }));
    }
    if (dirty.eligibility) {
      body.eligibility = elig.map((x) => ({
        requirement_type: x.requirement_type,
        status: x.status,
        details: nul(x.details),
        values: x.values,
        service_index: x.service_index === '' ? null : Number(x.service_index),
      }));
    }
    if (!Object.keys(body).length) {
      setErr(t('admin.noChanges'));
      return;
    }
    setBusy(true);
    try {
      await api.admin.edit(r.id, body);
      onSaved();
    } catch (e2) {
      setErr(adminError(e2, t));
    } finally {
      setBusy(false);
    }
  };

  const upd = <T,>(set: React.Dispatch<React.SetStateAction<T[]>>, key: keyof typeof dirty) => (i: number, patch: Partial<T>) => {
    set((rows) => rows.map((row, j) => (j === i ? { ...row, ...patch } : row)));
    setDirty((d) => ({ ...d, [key]: true }));
  };
  const updSvc = upd(setServices, 'services');
  const updSched = upd(setSchedules, 'schedules');
  const updElig = upd(setElig, 'eligibility');
  const remove = <T,>(set: React.Dispatch<React.SetStateAction<T[]>>, key: keyof typeof dirty, i: number) => {
    set((rows) => rows.filter((_, j) => j !== i));
    setDirty((d) => ({ ...d, [key]: true }));
  };

  const svcOptions = services.map((s, i) => (
    <option key={i} value={String(i)}>
      #{i + 1} {t(`serviceType.${s.service_type}`, { defaultValue: s.service_type })}
    </option>
  ));

  return (
    <form className="form editform" onSubmit={onSubmit}>
      <fieldset className="fgroup">
        <legend>{t('admin.coreFields')}</legend>
        <div className="grid-fields">
          {CORE.map((k) => (
            <div key={k} className={`field ${k === 'notes' || k === 'accessibility_notes' ? 'field--wide' : ''}`}>
              <label htmlFor={`ef-${k}`}>{t(`admin.fields.${k}`)}</label>
              {k === 'operating_status' ? (
                <select id={`ef-${k}`} value={core[k]} onChange={(e) => setCore({ ...core, [k]: e.target.value })}>
                  {['open', 'temporarily_closed', 'permanently_closed', 'unknown'].map((v) => (
                    <option key={v} value={v}>{t(`operating.${v}`)}</option>
                  ))}
                </select>
              ) : k === 'wheelchair_accessible' ? (
                <select id={`ef-${k}`} value={core[k]} onChange={(e) => setCore({ ...core, [k]: e.target.value })}>
                  {['unknown', 'yes', 'no'].map((v) => (
                    <option key={v} value={v}>{t(`access.${v}`)}</option>
                  ))}
                </select>
              ) : k === 'notes' || k === 'accessibility_notes' ? (
                <textarea id={`ef-${k}`} rows={3} value={core[k]} onChange={(e) => setCore({ ...core, [k]: e.target.value })} />
              ) : (
                <input
                  id={`ef-${k}`}
                  type={k === 'lat' || k === 'lon' ? 'number' : 'text'}
                  step={k === 'lat' || k === 'lon' ? 'any' : undefined}
                  value={core[k]}
                  onChange={(e) => setCore({ ...core, [k]: e.target.value })}
                />
              )}
            </div>
          ))}
        </div>
      </fieldset>

      <fieldset className="fgroup">
        <legend>{t('admin.services')}</legend>
        {services.map((s, i) => (
          <div key={i} className="editrow">
            <p className="editrow__title">#{i + 1}</p>
            <div className="grid-fields">
              <div className="field">
                <label htmlFor={`sv-${i}-type`}>{t('admin.fields.service_type')}</label>
                <select id={`sv-${i}-type`} value={s.service_type} onChange={(e) => updSvc(i, { service_type: e.target.value })}>
                  {SERVICE_TYPES.map((v) => <option key={v} value={v}>{t(`serviceType.${v}`)}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor={`sv-${i}-off`}>{t('admin.fields.offering_status')}</label>
                <select id={`sv-${i}-off`} value={s.offering_status} onChange={(e) => updSvc(i, { offering_status: e.target.value })}>
                  {OFFERING.map((v) => <option key={v} value={v}>{t(`offering.${v}`)}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor={`sv-${i}-appt`}>{t('requirement.appointment')}</label>
                <select id={`sv-${i}-appt`} value={s.appointment_required} onChange={(e) => updSvc(i, { appointment_required: e.target.value })}>
                  {TRI.map((v) => <option key={v} value={v}>{t(`tristate.${v}`)}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor={`sv-${i}-reg`}>{t('requirement.registration')}</label>
                <select id={`sv-${i}-reg`} value={s.registration_required} onChange={(e) => updSvc(i, { registration_required: e.target.value })}>
                  {TRI.map((v) => <option key={v} value={v}>{t(`tristate.${v}`)}</option>)}
                </select>
              </div>
              {(['frequency', 'household_limit', 'visit_limit'] as const).map((k) => (
                <div className="field" key={k}>
                  <label htmlFor={`sv-${i}-${k}`}>{t(`admin.fields.${k}`)}</label>
                  <input id={`sv-${i}-${k}`} value={s[k]} onChange={(e) => updSvc(i, { [k]: e.target.value } as Partial<SvcRow>)} />
                </div>
              ))}
              <div className="field field--wide">
                <label htmlFor={`sv-${i}-desc`}>{t('admin.fields.description')}</label>
                <textarea id={`sv-${i}-desc`} rows={2} value={s.description} onChange={(e) => updSvc(i, { description: e.target.value })} />
              </div>
              <div className="field field--wide">
                <label htmlFor={`sv-${i}-notes`}>{t('admin.fields.notes')}</label>
                <input id={`sv-${i}-notes`} value={s.notes} onChange={(e) => updSvc(i, { notes: e.target.value })} />
              </div>
            </div>
            <fieldset className="fgroup fgroup--inner">
              <legend>{t('admin.fields.food_types')}</legend>
              <div className="checks checks--cols">
                {FOOD_TYPES.map((f) => (
                  <label key={f} className="check check--sm">
                    <input
                      type="checkbox"
                      checked={s.food_types.includes(f)}
                      onChange={() => updSvc(i, { food_types: s.food_types.includes(f) ? s.food_types.filter((x) => x !== f) : [...s.food_types, f] })}
                    />
                    <span>{t(`foodType.${f}`)}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <button type="button" className="btn btn--danger-outline btn--sm" onClick={() => remove(setServices, 'services', i)}>
              {t('admin.removeRow')}
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          onClick={() => {
            setServices((rows) => [
              ...rows,
              { service_type: 'pantry_pickup', description: '', offering_status: 'unconfirmed', frequency: '', appointment_required: 'unknown',
                registration_required: 'unknown', household_limit: '', visit_limit: '', notes: '', food_types: [] },
            ]);
            setDirty((d) => ({ ...d, services: true }));
          }}
        >
          {t('admin.addService')}
        </button>
        {dirty.services && <p className="small muted">{t('admin.replacesSet')}</p>}
      </fieldset>

      <fieldset className="fgroup">
        <legend>{t('admin.schedules')}</legend>
        {schedules.map((s, i) => (
          <div key={i} className="editrow editrow--inline">
            <div className="field">
              <label htmlFor={`sc-${i}-kind`}>{t('admin.fields.kind')}</label>
              <select id={`sc-${i}-kind`} value={s.kind} onChange={(e) => updSched(i, { kind: e.target.value })}>
                <option value="distribution">{t('admin.scheduleKind.distribution')}</option>
                <option value="operating_hours">{t('admin.scheduleKind.operating_hours')}</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor={`sc-${i}-wd`}>{t('admin.fields.weekday')}</label>
              <select id={`sc-${i}-wd`} value={s.weekday} onChange={(e) => updSched(i, { weekday: Number(e.target.value) })}>
                {[0, 1, 2, 3, 4, 5, 6].map((d) => <option key={d} value={d}>{weekdayName(d, 'en')}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor={`sc-${i}-wom`}>{t('admin.fields.week_of_month')}</label>
              <select id={`sc-${i}-wom`} value={s.week_of_month} onChange={(e) => updSched(i, { week_of_month: e.target.value })}>
                <option value="">{t('admin.everyWeek')}</option>
                {['1', '2', '3', '4', '5', '-1'].map((w) => <option key={w} value={w}>{w === '-1' ? t('admin.lastWeek') : w}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor={`sc-${i}-o`}>{t('admin.fields.opens')}</label>
              <input id={`sc-${i}-o`} type="time" value={s.opens} onChange={(e) => updSched(i, { opens: e.target.value })} required />
            </div>
            <div className="field">
              <label htmlFor={`sc-${i}-c`}>{t('admin.fields.closes')}</label>
              <input id={`sc-${i}-c`} type="time" value={s.closes} onChange={(e) => updSched(i, { closes: e.target.value })} required />
            </div>
            <div className="field">
              <label htmlFor={`sc-${i}-svc`}>{t('admin.fields.service')}</label>
              <select id={`sc-${i}-svc`} value={s.service_index} onChange={(e) => updSched(i, { service_index: e.target.value })}>
                <option value="">{t('admin.wholeLocation')}</option>
                {svcOptions}
              </select>
            </div>
            <label className="check check--sm">
              <input type="checkbox" checked={s.appointment_only} onChange={(e) => updSched(i, { appointment_only: e.target.checked })} />
              <span>{t('card.appointmentOnly')}</span>
            </label>
            <div className="field">
              <label htmlFor={`sc-${i}-n`}>{t('admin.fields.notes')}</label>
              <input id={`sc-${i}-n`} value={s.notes} onChange={(e) => updSched(i, { notes: e.target.value })} />
            </div>
            <button type="button" className="btn btn--danger-outline btn--sm" onClick={() => remove(setSchedules, 'schedules', i)}>
              {t('admin.removeRow')}
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          onClick={() => {
            setSchedules((rows) => [...rows, { kind: 'distribution', weekday: 0, opens: '09:00', closes: '12:00', week_of_month: '', appointment_only: false, notes: '', service_index: '' }]);
            setDirty((d) => ({ ...d, schedules: true }));
          }}
        >
          {t('admin.addSchedule')}
        </button>
        {dirty.schedules && <p className="small muted">{t('admin.replacesSet')}</p>}
      </fieldset>

      <fieldset className="fgroup">
        <legend>{t('detail.eligibility')}</legend>
        {elig.map((x, i) => (
          <div key={i} className="editrow editrow--inline">
            <div className="field">
              <label htmlFor={`el-${i}-t`}>{t('detail.requirement')}</label>
              <select id={`el-${i}-t`} value={x.requirement_type} onChange={(e) => updElig(i, { requirement_type: e.target.value })}>
                {ELIGIBILITY_TYPES.map((v) => <option key={v} value={v}>{t(`requirement.${v}`)}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor={`el-${i}-s`}>{t('detail.status')}</label>
              <select id={`el-${i}-s`} value={x.status} onChange={(e) => updElig(i, { status: e.target.value })}>
                {TRI.map((v) => <option key={v} value={v}>{t(`tristate.${v}`)}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor={`el-${i}-svc`}>{t('admin.fields.service')}</label>
              <select id={`el-${i}-svc`} value={x.service_index} onChange={(e) => updElig(i, { service_index: e.target.value })}>
                <option value="">{t('admin.wholeLocation')}</option>
                {svcOptions}
              </select>
            </div>
            <div className="field field--grow">
              <label htmlFor={`el-${i}-d`}>{t('detail.details')}</label>
              <input id={`el-${i}-d`} value={x.details} onChange={(e) => updElig(i, { details: e.target.value })} />
            </div>
            <button type="button" className="btn btn--danger-outline btn--sm" onClick={() => remove(setElig, 'eligibility', i)}>
              {t('admin.removeRow')}
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          onClick={() => {
            setElig((rows) => [...rows, { requirement_type: 'photo_id', status: 'unknown', details: '', values: {}, service_index: '' }]);
            setDirty((d) => ({ ...d, eligibility: true }));
          }}
        >
          {t('admin.addEligibility')}
        </button>
        {dirty.eligibility && <p className="small muted">{t('admin.replacesSet')}</p>}
      </fieldset>

      {err && <p className="form-error" role="alert">{err}</p>}
      <div className="form__actions">
        <button type="submit" className="btn btn--primary" disabled={busy}>
          {busy ? t('admin.saving') : t('admin.saveEdits')}
        </button>
        <button type="button" className="btn btn--ghost" onClick={onCancel}>
          {t('admin.cancel')}
        </button>
      </div>
    </form>
  );
}
