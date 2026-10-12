import { useId, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { api } from '../../api/client';
import type { ProviderPantry, SurplusPost } from '../../api/types';
import { Icon } from '../../components/Icon';
import { Empty, ErrorMessage, errorKey, Loading } from '../../components/Status';
import { groupFoodTypes, toggle } from '../../lib/filters';
import { formatDateTime, localInputToISO, toLocalInput } from '../../lib/format';
import { useAsync } from '../../lib/useAsync';
import { useDocumentTitle } from '../../state/meta';

function SurplusForm({ mine, foodTypes, onPosted }: { mine: ProviderPantry[]; foodTypes?: string[]; onPosted: () => void }) {
  const { t } = useTranslation();
  const id = useId();
  const [loc, setLoc] = useState(mine[0]?.location_id ?? 0);
  const [title, setTitle] = useState('');
  const [types, setTypes] = useState<string[]>([]);
  const [quantity, setQuantity] = useState('');
  const [pickup, setPickup] = useState('');
  const [until, setUntil] = useState(() => toLocalInput(new Date(Date.now() + 2 * 864e5)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const all = useMemo(() => groupFoodTypes(foodTypes).flatMap((g) => g.types), [foodTypes]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setOk(null);
    const iso = localInputToISO(until);
    if (!loc || title.trim().length < 3 || !iso) {
      setError(t('portal.surplus.missing'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.provider.postSurplus({ location_id: loc, title: title.trim(), food_types: types, quantity: quantity.trim() || null, pickup_notes: pickup.trim() || null, available_until: iso });
      setOk(t('portal.surplus.posted'));
      setTitle('');
      setTypes([]);
      setQuantity('');
      setPickup('');
      onPosted();
    } catch (err) {
      setError(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="form card-section" onSubmit={submit} noValidate aria-labelledby={`${id}-t`}>
      <h2 id={`${id}-t`} className="section-title">
        {t('portal.surplus.offerTitle')}
      </h2>
      <div className="grid-fields">
        <div className="field">
          <label htmlFor={`${id}-loc`}>{t('portal.surplus.from')}</label>
          <select id={`${id}-loc`} value={loc} onChange={(e) => setLoc(Number(e.target.value))}>
            {mine.map((m) => (
              <option key={m.location_id} value={m.location_id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field field--wide">
          <label htmlFor={`${id}-title`}>{t('portal.surplus.what')}</label>
          <input id={`${id}-title`} maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-qty`}>
            {t('portal.surplus.quantity')} <span className="muted">({t('common.optional')})</span>
          </label>
          <input id={`${id}-qty`} maxLength={160} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-until`}>{t('portal.surplus.until')}</label>
          <input id={`${id}-until`} type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} />
        </div>
      </div>
      <fieldset className="fgroup">
        <legend>{t('portal.surplus.foodTypes')}</legend>
        <div className="checks checks--cols">
          {all.map((code) => (
            <label key={code} className="check check--sm">
              <input type="checkbox" checked={types.includes(code)} onChange={() => setTypes((x) => toggle(x, code))} />
              <span>{t(`foodType.${code}`, { defaultValue: code })}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="field">
        <label htmlFor={`${id}-pick`}>
          {t('portal.surplus.pickup')} <span className="muted">({t('common.optional')})</span>
        </label>
        <textarea id={`${id}-pick`} rows={2} maxLength={500} value={pickup} onChange={(e) => setPickup(e.target.value)} />
      </div>
      <div aria-live="polite">
        {error && <p className="form-error">{error}</p>}
        {ok && <p className="form-ok">{ok}</p>}
      </div>
      <button type="submit" className="btn btn--primary" disabled={busy}>
        {t('portal.surplus.post')}
      </button>
    </form>
  );
}

function SurplusItem({ s, mine, onChanged }: { s: SurplusPost; mine: ProviderPantry[]; onChanged: () => void }) {
  const { t, i18n } = useTranslation();
  const own = mine.some((m) => m.location_id === s.location_id);
  const others = mine.filter((m) => m.location_id !== s.location_id);
  const [claimFor, setClaimFor] = useState(others[0]?.location_id ?? 0);
  const [msg, setMsg] = useState<string | null>(null);
  const act = async (fn: () => Promise<unknown>, done: string) => {
    setMsg(null);
    try {
      await fn();
      setMsg(done);
      onChanged();
    } catch (e) {
      setMsg(t(errorKey(e)));
    }
  };
  return (
    <li className={`surplus surplus--${s.status}`}>
      <p className="surplus__head">
        <strong>{s.title}</strong> <span className={`pill pill--${s.status}`}>{t(`portal.surplus.status.${s.status}`, { defaultValue: s.status })}</span>
      </p>
      <p className="muted">
        {s.pantry}
        {s.city && `, ${s.city}`} · {t('portal.surplus.availableUntil', { date: formatDateTime(s.available_until, i18n.language) })}
      </p>
      {s.food_types.length > 0 && (
        <ul className="tags">
          {s.food_types.map((f) => (
            <li key={f}>{t(`foodType.${f}`, { defaultValue: f })}</li>
          ))}
        </ul>
      )}
      {s.quantity && <p>{t('portal.surplus.quantity')}: {s.quantity}</p>}
      {s.pickup_notes && <p>{s.pickup_notes}</p>}
      <div className="row-actions">
        {own && s.status !== 'closed' && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => void act(() => api.provider.closeSurplus(s.id), t('portal.surplus.closed'))}>
            {t('portal.surplus.close')}
          </button>
        )}
        {!own && s.status === 'open' && others.length > 0 && (
          <>
            {others.length > 1 && (
              <label>
                <span className="visually-hidden">{t('portal.surplus.claimFor')}</span>
                <select value={claimFor} onChange={(e) => setClaimFor(Number(e.target.value))}>
                  {others.map((m) => (
                    <option key={m.location_id} value={m.location_id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => void act(() => api.provider.claimSurplus(s.id, claimFor), t('portal.surplus.claimed'))}>
              {t('portal.surplus.claim')}
              <span className="visually-hidden"> — {s.title}</span>
            </button>
          </>
        )}
      </div>
      <p role="status" className="form-msg">
        {msg}
      </p>
    </li>
  );
}

/** Pantry-to-pantry surplus board (approved staff only; the server enforces it). */
export function SurplusBoard() {
  const { t } = useTranslation();
  useDocumentTitle(t('portal.surplus.title'));
  const me = useAsync(() => api.provider.me(), []);
  const board = useAsync(() => api.provider.surplus(), []);
  const mine = (me.data?.items || []).filter((m) => m.status === 'approved');
  return (
    <div className="page page--wide portal">
      <p>
        <Link to="/pantry">
          <Icon name="arrowLeft" size={16} /> {t('portal.backToPortal')}
        </Link>
      </p>
      <header className="portal__head">
        <p className="eyebrow">{t('portal.eyebrow')}</p>
        <h1 className="display display--sm">{t('portal.surplus.title')}</h1>
        <p className="lead">{t('portal.surplus.lead')}</p>
      </header>
      {(me.loading || board.loading) && !board.data && <Loading />}
      {!!board.error && <ErrorMessage error={board.error} onRetry={board.reload} />}
      {me.data && mine.length > 0 && <SurplusForm mine={mine} foodTypes={me.data.food_types} onPosted={board.reload} />}
      {board.data && (
        <section aria-labelledby="board-t">
          <h2 id="board-t" className="section-title">
            {t('portal.surplus.available')}
          </h2>
          {board.data.items.length === 0 ? (
            <Empty title={t('portal.surplus.empty')} />
          ) : (
            <ul className="surplus-list">
              {board.data.items.map((s) => (
                <SurplusItem key={s.id} s={s} mine={mine} onChanged={board.reload} />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
