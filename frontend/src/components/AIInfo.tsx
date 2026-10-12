import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../api/client';
import type { AIInfo, AIInfoField, AIInfoFieldName, AIInfoSource } from '../api/types';
import { safeUrl } from '../lib/format';
import { useAI } from '../state/meta';
import { Icon } from './Icon';

/**
 * AI-found facts for one listing. The detail page loads the cached result (GET, free) and, when there is none and the
 * `ai.listing_lookup` switch is on, offers "Find missing info with AI" (POST). Facts are shown INSIDE the section where
 * people look for them, always labelled "AI-found" with their source links, and never replace confirmed data: next to
 * confirmed information they are shown as "More details (AI-found)".
 */
type Phase = 'idle' | 'loading' | 'done' | 'error';

interface AIInfoState {
  /** Cached or freshly found facts (empty until loaded). */
  fields: AIInfoField[];
  ready: boolean;
  /** True when the lookup button should be offered. */
  canLookup: boolean;
  phase: Phase;
  errorKey: string | null;
  run: () => Promise<void>;
}

const EMPTY: AIInfoState = { fields: [], ready: false, canLookup: false, phase: 'idle', errorKey: null, run: async () => {} };
const Ctx = createContext<AIInfoState>(EMPTY);

function isReady(x: unknown): x is Extract<AIInfo, { status: 'ready' }> {
  return !!x && typeof x === 'object' && (x as AIInfo).status === 'ready' && Array.isArray((x as { fields?: unknown }).fields);
}

function cleanFields(fields: AIInfoField[]): AIInfoField[] {
  return fields.filter((f) => f && typeof f.field === 'string' && (Array.isArray(f.value) ? f.value.length > 0 : !!String(f.value ?? '').trim()));
}

function lookupErrorKey(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 429) return 'aiInfo.error.rateLimited';
    if (e.status === 503) return 'aiInfo.error.unavailable';
    if (e.status === 404) return 'aiInfo.error.off';
    if (e.status === 0) return 'errors.network';
  }
  return 'aiInfo.error.generic';
}

export function AIInfoProvider({ id, children }: { id: number; children: ReactNode }) {
  const flags = useAI();
  const [info, setInfo] = useState<AIInfo | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    setInfo(null);
    setPhase('idle');
    setErrorKey(null);
    const ctrl = new AbortController();
    api
      .aiInfo(id, ctrl.signal)
      .then((r) => alive.current && setInfo(r && typeof r === 'object' && 'status' in r ? r : null))
      .catch(() => {
        /* no cached AI info: the page simply shows confirmed data */
      });
    return () => {
      alive.current = false;
      ctrl.abort();
    };
  }, [id]);

  const run = useCallback(async () => {
    setPhase('loading');
    setErrorKey(null);
    try {
      const r = await api.aiInfoLookup(id);
      if (!alive.current) return;
      setInfo(r);
      setPhase('done');
    } catch (e) {
      if (!alive.current) return;
      setErrorKey(lookupErrorKey(e));
      setPhase('error');
    }
  }, [id]);

  const ready = isReady(info);
  const value: AIInfoState = {
    fields: ready ? cleanFields(info.fields) : [],
    ready,
    canLookup: !!flags.listing_lookup && info?.status === 'none' && info.available !== false,
    phase,
    errorKey,
    run,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAIInfo = () => useContext(Ctx);

function sourceLabel(s: AIInfoSource): string {
  if (s.title && s.title.trim()) return s.title.trim();
  try {
    return new URL(s.url).hostname.replace(/^www\./, '');
  } catch {
    return s.url;
  }
}

export function AIBadge() {
  const { t } = useTranslation();
  return (
    <span className="ai-badge ai-badge--found">
      <Icon name="sparkle" size={12} />
      {t('aiInfo.badge')}
    </span>
  );
}

function SourceLinks({ sources }: { sources: AIInfoSource[] }) {
  const { t } = useTranslation();
  const links = sources.map((s) => ({ s, href: safeUrl(s.url) })).filter((x) => x.href);
  if (!links.length) return null;
  return (
    <p className="aifact__sources">
      <span className="muted">{t('aiInfo.sources', { count: links.length })} </span>
      {links.map(({ s, href }, i) => (
        <span key={i}>
          {i > 0 && ', '}
          <a href={href!} target="_blank" rel="noopener noreferrer" title={s.quote ? `“${s.quote}”` : undefined}>
            {sourceLabel(s)}
            <Icon name="external" size={12} />
            <span className="visually-hidden"> ({t('aiInfo.opensSource')})</span>
          </a>
        </span>
      ))}
    </p>
  );
}

/**
 * The AI-found facts for the given fields, if any. `confirmed` = the section already has confirmed (non-AI)
 * information, so the AI text is offered as "More details (AI-found)" and never replaces it.
 */
export function AIFacts({ fields, confirmed, compact }: { fields: AIInfoFieldName[]; confirmed: boolean; compact?: boolean }) {
  const { t } = useTranslation();
  const { fields: all } = useAIInfo();
  const found = all.filter((f) => (fields as string[]).includes(f.field));
  if (!found.length) return null;
  return (
    <div className={`aifacts ${confirmed ? 'aifacts--more' : ''} ${compact ? 'aifacts--compact' : ''}`} data-testid="ai-facts">
      {confirmed && <p className="aifacts__more">{t('aiInfo.moreDetails')}</p>}
      {found.map((f) => (
        <div key={f.field} className="aifact" data-field={f.field}>
          <p className="aifact__head">
            <AIBadge />
            <strong>{t(`aiInfo.field.${f.field}`, { defaultValue: f.field })}</strong>
          </p>
          <p className="aifact__value">{Array.isArray(f.value) ? f.value.join(', ') : f.value}</p>
          <SourceLinks sources={f.sources || []} />
        </div>
      ))}
      <p className="aifacts__notice">
        <Icon name="info" size={14} />
        {t('aiInfo.notice')}
      </p>
    </div>
  );
}

/** Visit-planner panel: the "Find missing info with AI" button, its loading / error / result messages. */
export function AILookupPanel() {
  const { t } = useTranslation();
  const { canLookup, phase, errorKey, run, ready, fields } = useAIInfo();
  const statusRef = useRef<HTMLParagraphElement>(null);
  // After the lookup the button disappears; move focus to the result message so keyboard users aren't lost.
  useEffect(() => {
    if (phase === 'done') statusRef.current?.focus();
  }, [phase]);
  const showButton = canLookup && phase !== 'done';
  if (!showButton && phase === 'idle' && !ready) return null;
  return (
    <div className="ailookup" data-testid="ai-lookup">
      {showButton && (
        <>
          <button type="button" className="btn ailookup__btn" onClick={() => void run()} disabled={phase === 'loading'} aria-describedby="ailookup-hint">
            <span aria-hidden="true">✨</span> {t('aiInfo.button')} <span className="ai-badge">AI</span>
          </button>
          <p id="ailookup-hint" className="ailookup__hint">
            {t('aiInfo.hint')}
          </p>
        </>
      )}
      <div aria-live="polite" aria-atomic="true">
        {phase === 'loading' && (
          <p className="ailookup__status" role="status">
            <span className="spinner" aria-hidden="true" /> {t('aiInfo.searching')}
          </p>
        )}
        {phase === 'error' && errorKey && (
          <p className="ailookup__status ailookup__status--error">
            <Icon name="alert" size={16} />
            {t(errorKey)}
          </p>
        )}
        {(phase === 'done' || (phase === 'idle' && ready)) && (
          <p ref={statusRef} tabIndex={-1} className="ailookup__status ailookup__status--done">
            <AIBadge />
            {fields.length ? t('aiInfo.found', { count: fields.length }) : t('aiInfo.nothingFound')}
          </p>
        )}
      </div>
    </div>
  );
}
