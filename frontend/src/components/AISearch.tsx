import { useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { api, ApiError } from '../api/client';
import type { AISearchResult } from '../api/types';
import { DEFAULT_FILTERS, ELIGIBILITY_FILTERS, filtersFromURL, filtersToURL, FOOD_GROUPS, SERVICE_GROUPS, type Filters } from '../lib/filters';
import { useAI } from '../state/meta';
import { Icon } from './Icon';
import { errorKey } from './Status';

export interface AIState {
  aiExplanation?: string;
  aiNotice?: string;
}

const only = (vals: string[] | undefined, allowed: readonly string[]) => (vals || []).filter((v) => allowed.includes(v));

/** Turn the AI's suggested filters into explorer filters. Unknown codes are dropped; nothing else is invented. */
export function filtersFromAI(res: AISearchResult, base: Filters): Filters {
  const f = res.filters;
  const next: Filters = {
    ...base,
    food_groups: only(f.food_group, FOOD_GROUPS),
    service_groups: only(f.service_group, SERVICE_GROUPS),
    eligibility: only(f.eligibility, ELIGIBILITY_FILTERS),
    wheelchair: !!f.wheelchair,
    schedule: f.date ? 'date' : base.schedule,
    date: f.date || base.date,
    page: 1,
    bbox: null,
  };
  if (res.place) {
    next.lat = res.place.lat;
    next.lon = res.place.lon;
    next.label = res.place.label;
    next.jurisdiction = '';
  }
  return next;
}

/**
 * Optional "Describe what you need" box. Rendered only when the server enables AI search (features.ai.search).
 * Only the typed words are sent; the result is shown as normal, editable filters plus the AI's explanation.
 */
export function AISearch({ compact = false }: { compact?: boolean }) {
  const ai = useAI();
  const { t, i18n } = useTranslation();
  const id = useId();
  const navigate = useNavigate();
  const location = useLocation();
  const [sp] = useSearchParams();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [open, setOpen] = useState(!compact);
  if (!ai.search) return null;

  const carried = (location.state as AIState | null) || null;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const text = q.trim();
    if (text.length < 3) {
      setMsg(t('ai.search.tooShort'));
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await api.aiSearch(text, i18n.language === 'es' ? 'es' : 'en');
      const base = location.pathname === '/find' ? filtersFromURL(sp) : { ...DEFAULT_FILTERS };
      const next = filtersFromAI(res, base);
      if (next.lat === null && !next.jurisdiction && next.sort === 'distance') next.sort = 'name';
      const state: AIState = { aiExplanation: res.explanation, aiNotice: res.notice };
      navigate(`/find?${filtersToURL(next).toString()}`, { state });
    } catch (err) {
      setMsg(err instanceof ApiError && err.status === 429 ? t('ai.search.rateLimited') : t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`aisearch ${compact ? 'aisearch--compact' : ''}`} data-testid="ai-search">
      {carried?.aiExplanation && (
        <div className="aisearch__result" role="status">
          <Icon name="sparkle" size={16} />
          <div>
            <p className="aisearch__explain">{carried.aiExplanation}</p>
            {carried.aiNotice && <p className="aisearch__notice">{carried.aiNotice}</p>}
          </div>
        </div>
      )}
      {compact && !open ? (
        <button type="button" className="btn btn--ghost btn--sm" aria-expanded={false} onClick={() => setOpen(true)}>
          <Icon name="sparkle" size={16} />
          {t('ai.search.label')}
        </button>
      ) : (
        <form className="aisearch__form" onSubmit={onSubmit} aria-label={t('ai.search.label')}>
          <label htmlFor={`${id}-q`} className="aisearch__label">
            <Icon name="sparkle" size={16} />
            {t('ai.search.label')} <span className="muted">({t('common.optional')})</span>
          </label>
          <div className="search__row">
            <input
              id={`${id}-q`}
              type="text"
              value={q}
              maxLength={300}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('ai.search.placeholder')}
              aria-describedby={`${id}-privacy ${id}-msg`}
            />
            <button type="submit" className="btn btn--secondary" disabled={busy}>
              {busy ? t('ai.search.working') : t('ai.search.submit')}
            </button>
          </div>
          <p id={`${id}-privacy`} className="aisearch__privacy">
            {t('ai.search.privacy')}
          </p>
          <div id={`${id}-msg`} aria-live="polite">
            {msg && <p className="form-msg">{msg}</p>}
          </div>
        </form>
      )}
    </div>
  );
}
