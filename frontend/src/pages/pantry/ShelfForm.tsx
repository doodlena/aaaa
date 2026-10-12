import { useId, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import type { LiveShelf, LiveStatus, ShelfItem, ShelfLevel } from '../../api/types';
import { Icon } from '../../components/Icon';
import { LiveSummary, StatusGlyph } from '../../components/Live';
import { errorKey } from '../../components/Status';
import { FOOD_TYPES, groupFoodTypes } from '../../lib/filters';
import { endOfTodayInput, localInputToISO } from '../../lib/format';

export const STATUSES: LiveStatus[] = ['open', 'limited', 'out', 'closed'];
export const LEVELS: ShelfLevel[] = ['plenty', 'some', 'low'];
const MSG_MAX = 280;

export interface ShelfPrefill {
  status: LiveStatus | null;
  message: string | null;
  items: ShelfItem[];
}

export function AIDraftedNotice({ things }: { things: string[] }) {
  const { t } = useTranslation();
  return (
    <div className="ai-drafted" role="note">
      <p className="ai-drafted__title">
        <Icon name="sparkle" size={16} />
        {t('ai.draft.drafted')}
      </p>
      {things.length > 0 && (
        <>
          <p className="ai-drafted__sub">{t('ai.draft.thingsToCheck')}</p>
          <ul>
            {things.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/**
 * Post today's shelf: one-tap status, items with levels, a short message, and when it expires (default: end of today).
 * Nothing is sent until "Post to families" is pressed — also when the form was prefilled by an AI draft.
 */
export function ShelfForm({
  locationId,
  foodTypes,
  food = true,
  prefill,
  aiDrafted = false,
  thingsToCheck = [],
  onPosted,
}: {
  locationId: number;
  foodTypes?: string[];
  /** False for listings that offer no food: no "Out of food" status and no shelf items. */
  food?: boolean;
  prefill?: ShelfPrefill | null;
  aiDrafted?: boolean;
  thingsToCheck?: string[];
  onPosted: (live: LiveShelf) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [status, setStatus] = useState<LiveStatus | null>(prefill?.status ?? null);
  const [items, setItems] = useState<Record<string, ShelfLevel>>(() =>
    Object.fromEntries((prefill?.items || []).filter((i) => FOOD_TYPES[i.food_type] || foodTypes?.includes(i.food_type)).map((i) => [i.food_type, i.level])),
  );
  const [message, setMessage] = useState((prefill?.message || '').slice(0, MSG_MAX));
  const [expires, setExpires] = useState(endOfTodayInput());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const groups = useMemo(() => groupFoodTypes(foodTypes), [foodTypes]);

  const itemList: ShelfItem[] = Object.entries(items).map(([food_type, level]) => ({ food_type, level, group: FOOD_TYPES[food_type] }));
  const preview: LiveShelf | null = status
    ? { status, message: message.trim() || null, items: itemList, posted_at: new Date().toISOString(), expires_at: localInputToISO(expires) || new Date().toISOString(), source: 'pantry', ai_assisted: aiDrafted }
    : null;

  const toggleItem = (code: string) =>
    setItems((cur) => {
      const next = { ...cur };
      if (next[code]) delete next[code];
      else next[code] = 'some';
      return next;
    });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setOk(null);
    if (!status) {
      setError(t('portal.shelf.chooseStatus'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const live = await api.provider.postShelf(locationId, {
        status,
        message: message.trim() || null,
        items: !food || status === 'closed' ? [] : itemList.map(({ food_type, level }) => ({ food_type, level })),
        expires_at: localInputToISO(expires),
        ai_assisted: aiDrafted,
      });
      setOk(t('portal.shelf.posted'));
      onPosted(live);
    } catch (err) {
      setError(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={`form shelf-form ${aiDrafted ? 'is-ai-drafted' : ''}`} onSubmit={submit} noValidate aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`}>{t('portal.shelf.title')}</h3>
      {aiDrafted && <AIDraftedNotice things={thingsToCheck} />}

      <fieldset className="fgroup">
        <legend>{t('portal.shelf.statusLegend')}</legend>
        <div className="status-buttons" role="group">
          {STATUSES.filter((s) => food || s !== 'out').map((s) => (
            <button
              key={s}
              type="button"
              className={`status-btn status-btn--${s}`}
              aria-pressed={status === s}
              onClick={() => setStatus(s)}
            >
              <StatusGlyph status={s} size={22} />
              <span>{t(`portal.shelf.statusButton.${s}`)}</span>
            </button>
          ))}
        </div>
      </fieldset>

      {food && status !== 'closed' && (
        <fieldset className="fgroup">
          <legend>{t('portal.shelf.itemsLegend')}</legend>
          <p className="fgroup__hint">{t('portal.shelf.itemsHint')}</p>
          <div className="item-picker">
            {groups.map((g) => (
              <fieldset key={g.group} className="fgroup fgroup--inner item-picker__group">
                <legend>{t(`foodGroup.${g.group}`)}</legend>
                {g.types.map((code) => {
                  const on = !!items[code];
                  return (
                    <div key={code} className={`item-row ${on ? 'is-on' : ''}`}>
                      <label className="check">
                        <input type="checkbox" checked={on} onChange={() => toggleItem(code)} />
                        <span>{t(`foodType.${code}`, { defaultValue: code })}</span>
                      </label>
                      {on && (
                        <label className="item-row__level">
                          <span className="visually-hidden">{t('portal.shelf.levelFor', { food: t(`foodType.${code}`) })}</span>
                          <select value={items[code]} onChange={(e) => setItems((cur) => ({ ...cur, [code]: e.target.value as ShelfLevel }))}>
                            {LEVELS.map((l) => (
                              <option key={l} value={l}>
                                {t(`live.level.${l}`)}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                    </div>
                  );
                })}
              </fieldset>
            ))}
          </div>
        </fieldset>
      )}

      <div className="field">
        <label htmlFor={`${id}-msg`}>
          {t('portal.shelf.message')} <span className="muted">({t('common.optional')})</span>
        </label>
        <textarea
          id={`${id}-msg`}
          rows={2}
          maxLength={MSG_MAX}
          value={message}
          onChange={(e) => setMessage(e.target.value.slice(0, MSG_MAX))}
          aria-describedby={`${id}-msg-count`}
        />
        <p id={`${id}-msg-count`} className="fgroup__hint">
          {t('common.charsLeft', { count: MSG_MAX - message.length })}
        </p>
      </div>
      <div className="field">
        <label htmlFor={`${id}-exp`}>{t('portal.shelf.expires')}</label>
        <input id={`${id}-exp`} type="datetime-local" value={expires} onChange={(e) => setExpires(e.target.value)} aria-describedby={`${id}-exp-hint`} />
        <p id={`${id}-exp-hint`} className="fgroup__hint">
          {t('portal.shelf.expiresHint')}
        </p>
      </div>

      {preview && (
        <div className="preview">
          <p className="preview__label">{t('portal.shelf.preview')}</p>
          <LiveSummary live={preview} compact={false} />
        </div>
      )}

      <div aria-live="polite">
        {error && <p className="form-error">{error}</p>}
        {ok && <p className="form-ok">{ok}</p>}
      </div>
      <div className="form__actions">
        <button type="submit" className="btn btn--primary btn--lg" disabled={busy}>
          {busy ? t('common.sending') : t('portal.shelf.post')}
        </button>
      </div>
    </form>
  );
}
