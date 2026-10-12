import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { api, ApiError } from '../../api/client';
import type { AnnouncementDraft, LiveShelf, ProviderPantry } from '../../api/types';
import { Icon } from '../../components/Icon';
import { LiveStatusTag, LiveSummary, ShelfTags } from '../../components/Live';
import { ErrorMessage, errorKey, Loading } from '../../components/Status';
import { formatDateTime } from '../../lib/format';
import { useAsync } from '../../lib/useAsync';
import { useAI, useDocumentTitle } from '../../state/meta';
import { CorrectionForm } from './CorrectionForm';
import { ClosureForm, EventForm } from './EventClosureForms';
import { ReportsInbox } from './ReportsInbox';
import { ShelfForm } from './ShelfForm';
import { ConfirmListing, StaffPanel } from './StaffAndConfirm';

type Tab = 'shelf' | 'event' | 'closure' | 'correction' | 'reports';

/** "Paste your announcement" → AI draft → prefill the matching form. It never posts anything by itself. */
export function AnnouncementPaste({ locationId, onDraft }: { locationId: number; onDraft: (d: AnnouncementDraft) => void }) {
  const { t } = useTranslation();
  const id = useId();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const draft = async () => {
    if (text.trim().length < 5) {
      setMsg(t('ai.draft.tooShort'));
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await api.provider.announcementDraft(locationId, text.trim());
      if (res.draft.kind === 'unclear') setMsg(t('ai.draft.unclear'));
      onDraft(res.draft);
    } catch (e) {
      setMsg(e instanceof ApiError && e.status === 429 ? t('ai.draft.rateLimited') : t(errorKey(e)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="ai-paste" aria-labelledby={`${id}-t`}>
      <h2 id={`${id}-t`} className="section-title">
        <Icon name="sparkle" />
        {t('ai.draft.title')}
      </h2>
      <p className="muted">{t('ai.draft.lead')}</p>
      <div className="field">
        <label htmlFor={`${id}-text`}>{t('ai.draft.label')}</label>
        <textarea id={`${id}-text`} rows={4} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} aria-describedby={`${id}-privacy`} />
        <p id={`${id}-privacy`} className="fgroup__hint">
          {t('ai.draft.privacy')}
        </p>
      </div>
      <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => void draft()}>
        <Icon name="sparkle" size={16} />
        {busy ? t('ai.draft.working') : t('ai.draft.submit')}
      </button>
      <div aria-live="polite">{msg && <p className="form-msg">{msg}</p>}</div>
    </section>
  );
}

function CurrentShelf({ p, onChanged }: { p: ProviderPantry; onChanged: () => void }) {
  const { t, i18n } = useTranslation();
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const history = useAsync(() => api.provider.shelfHistory(p.location_id), [p.location_id, p.live?.posted_at]);
  const clear = async () => {
    setMsg(null);
    try {
      await api.provider.clearShelf(p.location_id);
      setConfirm(false);
      setMsg(t('portal.shelf.cleared'));
      onChanged();
    } catch (e) {
      setMsg(t(errorKey(e)));
    }
  };
  return (
    <section className="card-section current-shelf" aria-labelledby="current-shelf-t">
      <h2 id="current-shelf-t" className="section-title">
        {t('portal.current.title')}
      </h2>
      {p.live ? (
        <>
          <LiveSummary live={p.live} compact={false} />
          {!confirm ? (
            <button type="button" className="btn btn--danger-outline btn--sm" onClick={() => setConfirm(true)}>
              {t('portal.shelf.clear')}
            </button>
          ) : (
            <div className="confirm" role="group" aria-label={t('portal.shelf.clear')}>
              <p>{t('portal.shelf.clearConfirm')}</p>
              <button type="button" className="btn btn--danger btn--sm" onClick={() => void clear()}>
                {t('portal.shelf.clearYes')}
              </button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setConfirm(false)}>
                {t('common.cancel')}
              </button>
            </div>
          )}
        </>
      ) : (
        <p className="unknown-text">
          <Icon name="question" size={15} />
          {t('portal.current.none')}
        </p>
      )}
      <p role="status" className="form-msg">
        {msg}
      </p>
      {history.data && history.data.items.length > 0 && (
        <details className="history">
          <summary>{t('portal.current.history', { count: history.data.items.length })}</summary>
          <ul>
            {history.data.items.map((h) => (
              <li key={h.id} className={h.retracted ? 'is-retracted' : ''}>
                <LiveStatusTag status={h.status} />
                <time dateTime={h.posted_at}>{formatDateTime(h.posted_at, i18n.language)}</time>
                {h.retracted && <span className="muted"> · {t('portal.current.retracted')}</span>}
                {h.message && <span className="muted"> · “{h.message}”</span>}
                <ShelfTags items={h.items} compact />
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

export function PantryDashboard() {
  const { t } = useTranslation();
  const ai = useAI();
  const { id } = useParams();
  const locationId = Number(id);
  const me = useAsync(() => api.provider.me(), []);
  const [tab, setTab] = useState<Tab>('shelf');
  const [draft, setDraft] = useState<AnnouncementDraft | null>(null);
  const [draftKey, setDraftKey] = useState(0);
  const [lastPosted, setLastPosted] = useState<LiveShelf | null>(null);
  const p = me.data?.items.find((x) => x.location_id === locationId && x.status === 'approved');
  useDocumentTitle(p ? t('portal.dashboardTitle', { name: p.name }) : undefined);

  if (me.loading && !me.data) return <Loading />;
  if (me.error) return <ErrorMessage error={me.error} onRetry={me.reload} />;
  if (!p) {
    return (
      <div className="page page--narrow">
        <h1>{t('portal.notApprovedTitle')}</h1>
        <p>{t('portal.notApproved')}</p>
        <Link to="/pantry">{t('portal.backToPortal')}</Link>
      </div>
    );
  }

  const onDraft = (d: AnnouncementDraft) => {
    if (d.kind === 'unclear') return;
    setDraft(d);
    setDraftKey((k) => k + 1);
    setTab(d.kind === 'event' ? 'event' : d.kind === 'closure' ? 'closure' : 'shelf');
  };
  const food = p.offers_food !== false;
  const drafted = (kind: AnnouncementDraft['kind']) => !!draft && draft.kind === kind;
  const tabs: { k: Tab; label: string }[] = [
    { k: 'shelf', label: t('portal.tabs.shelf') },
    { k: 'event', label: food ? t('portal.tabs.event') : t('portal.tabs.eventService') },
    { k: 'closure', label: t('portal.tabs.closure') },
    { k: 'correction', label: t('portal.tabs.correction') },
    { k: 'reports', label: p.open_reports ? t('portal.tabs.reportsCount', { count: p.open_reports }) : t('portal.tabs.reports') },
  ];

  return (
    <div className="page page--wide portal">
      <p>
        <Link to="/pantry">
          <Icon name="arrowLeft" size={16} /> {t('portal.backToPortal')}
        </Link>
      </p>
      <header className="portal__head">
        <p className="eyebrow">{t('portal.eyebrow')}</p>
        <h1 className="display display--sm">{p.name}</h1>
        <p className="muted">
          {[p.address1, p.city].filter(Boolean).join(', ')} · {p.role_title} ·{' '}
          <Link to={`/resource/${p.location_id}`}>{t('portal.viewPublic')}</Link>
        </p>
      </header>

      <div className="portal__grid">
        <div className="portal__main">
          {ai.announcement_drafts && <AnnouncementPaste locationId={p.location_id} onDraft={onDraft} />}

          <div className="tabs" role="group" aria-label={t('portal.tabs.label')}>
            {tabs.map((x) => (
              <button key={x.k} type="button" className="tab" aria-pressed={tab === x.k} onClick={() => setTab(x.k)}>
                {x.label}
              </button>
            ))}
          </div>

          <div className="portal__panel">
            {tab === 'shelf' && (
              <ShelfForm
                key={`shelf-${draftKey}`}
                locationId={p.location_id}
                foodTypes={me.data?.food_types}
                food={food}
                prefill={drafted('shelf_update') ? { status: draft!.status, message: draft!.message, items: draft!.items } : null}
                aiDrafted={drafted('shelf_update')}
                thingsToCheck={drafted('shelf_update') ? draft!.things_to_check : []}
                onPosted={(live) => {
                  setLastPosted(live);
                  setDraft(null);
                  me.reload();
                }}
              />
            )}
            {tab === 'event' && (
              <EventForm
                key={`event-${draftKey}`}
                locationId={p.location_id}
                foodTypes={me.data?.food_types}
                food={food}
                prefill={drafted('event') ? draft!.event : null}
                aiDrafted={drafted('event')}
                thingsToCheck={drafted('event') ? draft!.things_to_check : []}
              />
            )}
            {tab === 'closure' && (
              <ClosureForm
                key={`closure-${draftKey}`}
                locationId={p.location_id}
                prefill={drafted('closure') ? draft!.closure : null}
                aiDrafted={drafted('closure')}
                thingsToCheck={drafted('closure') ? draft!.things_to_check : []}
              />
            )}
            {tab === 'correction' && <CorrectionForm locationId={p.location_id} food={food} serviceTypes={p.service_types} />}
            {tab === 'reports' && <ReportsInbox locationId={p.location_id} />}
          </div>
        </div>
        <aside className="portal__side">
          <CurrentShelf p={lastPosted && !p.live ? { ...p, live: lastPosted } : p} onChanged={me.reload} />
          <ConfirmListing p={p} onConfirmed={me.reload} />
          <StaffPanel locationId={p.location_id} />
          <p className="muted small">{t('portal.trust')}</p>
        </aside>
      </div>
    </div>
  );
}
