import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ELIGIBILITY_FILTERS,
  FOOD_GROUPS,
  LANGUAGE_FILTERS,
  SERVICE_GROUPS,
  toggle,
  type Filters,
  type ScheduleMode,
} from '../lib/filters';
import { todayISO } from '../lib/format';

interface Props {
  filters: Filters;
  onChange: (patch: Partial<Filters>) => void;
  onClear: () => void;
}

function languageName(code: string, uiLang: string): string {
  try {
    const dn = new Intl.DisplayNames([uiLang], { type: 'language' });
    const name = dn.of(code);
    return name ? name.charAt(0).toUpperCase() + name.slice(1) : code;
  } catch {
    return code;
  }
}

function CheckGroup({ legend, hint, options, selected, labelKey, onToggle }: {
  legend: string;
  hint?: string;
  options: readonly string[];
  selected: string[];
  labelKey: string;
  onToggle: (v: string) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <fieldset className="fgroup">
      <legend>{legend}</legend>
      {hint && <p className="fgroup__hint" id={`${id}-hint`}>{hint}</p>}
      <div className="checks">
        {options.map((o) => (
          <label key={o} className="check">
            <input type="checkbox" checked={selected.includes(o)} onChange={() => onToggle(o)} aria-describedby={hint ? `${id}-hint` : undefined} />
            <span>{t(`${labelKey}.${o}`)}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function FiltersPanel({ filters, onChange, onClear }: Props) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const setSchedule = (schedule: ScheduleMode) =>
    onChange({ schedule, date: schedule === 'date' ? filters.date || todayISO() : filters.date });

  return (
    <div className="filters">
      <CheckGroup
        legend={t('filters.foodGroups')}
        options={FOOD_GROUPS}
        selected={filters.food_groups}
        labelKey="foodGroup"
        onToggle={(v) => onChange({ food_groups: toggle(filters.food_groups, v) })}
      />

      <CheckGroup
        legend={t('filters.serviceGroups')}
        options={SERVICE_GROUPS}
        selected={filters.service_groups}
        labelKey="serviceGroup"
        onToggle={(v) => onChange({ service_groups: toggle(filters.service_groups, v) })}
      />

      <fieldset className="fgroup">
        <legend>{t('filters.schedule')}</legend>
        <div className="checks">
          {(['any', 'today', 'date', 'upcoming'] as const).map((m) => (
            <label key={m} className="check">
              <input type="radio" name={`${id}-schedule`} checked={filters.schedule === m} onChange={() => setSchedule(m)} />
              <span>{t(`filters.scheduleMode.${m}`)}</span>
            </label>
          ))}
        </div>
        {filters.schedule === 'date' && (
          <div className="field">
            <label htmlFor={`${id}-date`}>{t('filters.dateLabel')}</label>
            <input id={`${id}-date`} type="date" value={filters.date} min={todayISO()} onChange={(e) => onChange({ date: e.target.value })} />
          </div>
        )}
        <p className="fgroup__hint">{t('filters.scheduleHint')}</p>
      </fieldset>

      <CheckGroup
        legend={t('filters.eligibility')}
        hint={t('filters.eligibilityHint')}
        options={ELIGIBILITY_FILTERS}
        selected={filters.eligibility}
        labelKey="eligibilityFilter"
        onToggle={(v) => onChange({ eligibility: toggle(filters.eligibility, v) })}
      />

      <fieldset className="fgroup">
        <legend>{t('filters.access')}</legend>
        <label className="check">
          <input type="checkbox" checked={filters.wheelchair} onChange={(e) => onChange({ wheelchair: e.target.checked })} />
          <span>{t('filters.wheelchair')}</span>
        </label>
        <div className="field">
          <label htmlFor={`${id}-lang`}>{t('filters.language')}</label>
          <select id={`${id}-lang`} value={filters.language} onChange={(e) => onChange({ language: e.target.value })}>
            <option value="">{t('filters.languageAny')}</option>
            {LANGUAGE_FILTERS.map((code) => (
              <option key={code} value={code}>
                {languageName(code, i18n.language)}
              </option>
            ))}
          </select>
        </div>
      </fieldset>

      <button type="button" className="btn btn--ghost" onClick={onClear}>
        {t('filters.clear')}
      </button>
    </div>
  );
}
