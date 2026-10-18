import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ELIGIBILITY_FILTERS,
  FOOD_GROUPS,
  FOOD_SERVICE_GROUPS,
  isFoodContext,
  LANGUAGE_FILTERS,
  SUPPORT_SERVICE_GROUPS,
  toggle,
  type Filters,
  type ScheduleMode,
} from '../lib/filters';
import { todayISO } from '../lib/format';
import { useProviderFeatures } from '../state/meta';

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

function CheckGroup({ legend, hint, options, selected, labelKey, onToggle, inner = false }: {
  inner?: boolean;
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
    <fieldset className={`fgroup ${inner ? 'fgroup--inner' : ''}`}>
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

  const food = isFoodContext(filters);
  const provider = useProviderFeatures(); // "today" filters need live provider posts
  const toggleService = (v: string) => {
    const service_groups = toggle(filters.service_groups, v);
    // Leaving every food need behind drops the food-only filters too (they would silently narrow the results).
    const stillFood = isFoodContext({ service_groups, food_groups: filters.food_groups });
    onChange(stillFood ? { service_groups } : { service_groups, live_food_groups: [], live_open: false });
  };

  return (
    <div className="filters">
      <CheckGroup
        legend={t('filters.supportGroups')}
        hint={t('filters.serviceGroupsHint')}
        options={SUPPORT_SERVICE_GROUPS}
        selected={filters.service_groups}
        labelKey="serviceGroup"
        onToggle={toggleService}
      />

      <CheckGroup
        legend={t('filters.serviceGroups')}
        options={FOOD_SERVICE_GROUPS}
        selected={filters.service_groups}
        labelKey="serviceGroup"
        onToggle={toggleService}
      />

      {food ? (
      <>
      {provider && (
      <fieldset className="fgroup fgroup--live">
        <legend>{t('filters.today')}</legend>
        <p className="fgroup__hint" id={`${id}-live-hint`}>
          {t('filters.todayHint')}
        </p>
        <label className="check">
          <input
            type="checkbox"
            checked={filters.live_open}
            onChange={(e) => onChange({ live_open: e.target.checked })}
            aria-describedby={`${id}-live-hint`}
          />
          <span>{t('filters.liveOpen')}</span>
        </label>
        <CheckGroup
          legend={t('filters.onShelfToday')}
          options={FOOD_GROUPS}
          selected={filters.live_food_groups}
          labelKey="foodGroup"
          inner
          onToggle={(v) => onChange({ live_food_groups: toggle(filters.live_food_groups, v) })}
        />
      </fieldset>
      )}

      <CheckGroup
        legend={t('filters.foodGroups')}
        options={FOOD_GROUPS}
        selected={filters.food_groups}
        labelKey="foodGroup"
        onToggle={(v) => onChange({ food_groups: toggle(filters.food_groups, v) })}
      />
      </>
      ) : (
        <p className="fgroup__hint filters__food-hidden">{t('filters.foodHidden')}</p>
      )}

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
