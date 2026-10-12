import { useEffect, useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../api/client';
import type { AISettings, AITestResult } from '../../api/types';
import { Icon } from '../../components/Icon';
import { ErrorMessage, Loading } from '../../components/Status';
import { useAsync } from '../../lib/useAsync';
import { useMeta } from '../../state/meta';
import { adminError } from './shared';

type State = 'active' | 'off' | 'nokey';
const stateOf = (s: AISettings): State => (s.key_source === 'none' ? 'nokey' : s.active ? 'active' : 'off');

/** Status shown as shape + icon + text: Active = solid, Off = square outline, No key = dashed. */
function AIStatus({ s }: { s: AISettings }) {
  const { t } = useTranslation();
  const st = stateOf(s);
  return (
    <span className={`ai-state ai-state--${st}`} data-testid="ai-state">
      <Icon name={st === 'active' ? 'check' : st === 'off' ? 'close' : 'question'} size={16} />
      {t(`admin.aiSettings.state.${st}`)}
    </span>
  );
}

function TestResult({ r }: { r: AITestResult }) {
  const { t } = useTranslation();
  return r.ok ? (
    <p className="form-ok" data-testid="ai-test-result">
      <Icon name="check" size={16} /> {t('admin.aiSettings.testOk', { name: r.display_name || r.model || '' })}
    </p>
  ) : (
    <p className="form-error" data-testid="ai-test-result">
      <Icon name="alert" size={16} /> {t('admin.aiSettings.testFailed', { error: r.error || t('errors.server') })}
    </p>
  );
}

/**
 * /admin/ai — add, test, switch and remove the Anthropic API key. The key is write-only: it is sent once and the page
 * only ever shows the server's hint ("…WXYZ"). After every change /api/meta/features is re-fetched so AI search,
 * announcement drafts and AI suggestions appear or disappear without a reload.
 */
export function AdminAI() {
  const { t } = useTranslation();
  const id = useId();
  const { refreshFeatures } = useMeta();
  const loaded = useAsync(() => api.admin.aiSettings(), []);
  const [s, setS] = useState<AISettings | null>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState<null | 'save' | 'toggle' | 'model' | 'test' | 'delete'>(null);
  const [test, setTest] = useState<AITestResult | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (loaded.data) setS(loaded.data);
  }, [loaded.data]);

  const run = async <T,>(kind: NonNullable<typeof busy>, fn: () => Promise<T>, after: (r: T) => void) => {
    setBusy(kind);
    setMsg(null);
    try {
      const r = await fn();
      after(r);
      await refreshFeatures();
    } catch (e) {
      const text =
        kind === 'save' && e instanceof ApiError && e.status === 422 ? t('admin.aiSettings.keyShape') : adminError(e, t);
      setMsg({ ok: false, text });
    } finally {
      setBusy(null);
    }
  };

  const onSave = (e: FormEvent) => {
    e.preventDefault();
    const k = key.trim();
    if (!k) {
      setMsg({ ok: false, text: t('admin.aiSettings.keyRequired') });
      return;
    }
    setTest(null);
    void run('save', () => api.admin.saveAIKey(k), (r) => {
      const { test: tr, ...rest } = r;
      setKey(''); // never keep the key around after sending it
      setS(rest);
      setTest(tr);
      setMsg({ ok: true, text: t('admin.aiSettings.saved', { hint: rest.key_hint || '' }) });
    });
  };

  if (loaded.loading && !s) return <Loading />;
  if (loaded.error && !s) return <ErrorMessage error={loaded.error} onRetry={loaded.reload} />;
  if (!s) return null;
  const st = stateOf(s);

  return (
    <div className="ai-admin">
      <h1>{t('admin.aiSettings.title')}</h1>
      <p className="lead">{t('admin.aiSettings.lead')}</p>

      <section className={`ai-card ai-card--${st}`} aria-labelledby={`${id}-status`}>
        <h2 id={`${id}-status`} className="ai-card__title">
          {t('admin.aiSettings.statusTitle')} <AIStatus s={s} />
        </h2>
        <dl className="kvs kvs--compact">
          <div className="kv">
            <dt>{t('admin.aiSettings.keyLabel')}</dt>
            <dd>
              {s.key_hint ? <span className="mono" data-testid="ai-key-hint">{s.key_hint}</span> : <span className="muted">{t('admin.aiSettings.noKey')}</span>}
              {s.key_source !== 'none' && <span className="muted small"> · {t(`admin.aiSettings.source.${s.key_source}`, { defaultValue: s.key_source })}</span>}
            </dd>
          </div>
          <div className="kv">
            <dt>{t('admin.aiSettings.modelLabel')}</dt>
            <dd className="mono">{s.model}</dd>
          </div>
        </dl>
        <p className="muted small">{t(`admin.aiSettings.stateHelp.${st}`)}</p>
      </section>

      <div role="status" aria-live="polite" className="ai-admin__msg">
        {msg && <p className={msg.ok ? 'form-ok' : 'form-error'}>{msg.text}</p>}
        {test && <TestResult r={test} />}
      </div>

      <section className="ai-section" aria-labelledby={`${id}-key`}>
        <h2 id={`${id}-key`}>{s.key_source === 'admin' ? t('admin.aiSettings.replaceTitle') : t('admin.aiSettings.addTitle')}</h2>
        <form className="form" onSubmit={onSave} autoComplete="off">
          <div className="field">
            <label htmlFor={`${id}-k`}>{t('admin.aiSettings.keyInput')}</label>
            <p className="fgroup__hint" id={`${id}-kh`}>
              {t('admin.aiSettings.keyHint')}
            </p>
            <input
              id={`${id}-k`}
              name="anthropic-api-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              aria-describedby={`${id}-kh`}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="sk-ant-…"
            />
          </div>
          <div className="form__actions">
            <button type="submit" className="btn btn--primary" disabled={busy !== null}>
              <Icon name="key" />
              {busy === 'save' ? t('admin.aiSettings.saving') : t('admin.aiSettings.save')}
            </button>
          </div>
        </form>
      </section>

      <section className="ai-section" aria-labelledby={`${id}-use`}>
        <h2 id={`${id}-use`}>{t('admin.aiSettings.useTitle')}</h2>
        <label className="check switch">
          <input
            type="checkbox"
            role="switch"
            checked={s.enabled}
            disabled={busy !== null || st === 'nokey'}
            onChange={(e) => {
              const enabled = e.target.checked;
              void run('toggle', () => api.admin.patchAISettings({ enabled }), (r) => {
                setS(r);
                setMsg({ ok: true, text: enabled ? t('admin.aiSettings.turnedOn') : t('admin.aiSettings.turnedOff') });
              });
            }}
          />
          <span>{t('admin.aiSettings.enableLabel')}</span>
        </label>
        {st === 'nokey' && <p className="fgroup__hint">{t('admin.aiSettings.enableNeedsKey')}</p>}

        <div className="field field--inline">
          <label htmlFor={`${id}-m`}>{t('admin.aiSettings.modelLabel')}</label>
          <select
            id={`${id}-m`}
            value={s.model}
            disabled={busy !== null}
            onChange={(e) => {
              const model = e.target.value;
              void run('model', () => api.admin.patchAISettings({ model }), (r) => {
                setS(r);
                setMsg({ ok: true, text: t('admin.aiSettings.modelSaved', { model }) });
              });
            }}
          >
            {s.allowed_models.map((m) => (
              <option key={m} value={m}>
                {t(`admin.aiSettings.models.${m}`, { defaultValue: m })}
              </option>
            ))}
          </select>
        </div>

        <div className="form__actions">
          <button
            type="button"
            className="btn btn--secondary"
            disabled={busy !== null || st === 'nokey'}
            onClick={() => {
              setTest(null);
              void run('test', () => api.admin.testAI(), (r) => setTest(r));
            }}
          >
            {busy === 'test' ? t('admin.aiSettings.testing') : t('admin.aiSettings.test')}
          </button>
          {s.key_source === 'admin' && !confirmDelete && (
            <button type="button" className="btn btn--danger-outline" disabled={busy !== null} onClick={() => setConfirmDelete(true)}>
              {t('admin.aiSettings.remove')}
            </button>
          )}
        </div>
        {s.key_source === 'environment' && <p className="fgroup__hint">{t('admin.aiSettings.envKey')}</p>}

        {confirmDelete && (
          <div className="confirm" role="group" aria-labelledby={`${id}-del`}>
            <p id={`${id}-del`}>
              <strong>{t('admin.aiSettings.removeConfirmTitle')}</strong> {t('admin.aiSettings.removeConfirmBody')}
            </p>
            <div className="form__actions">
              <button
                type="button"
                className="btn btn--danger"
                disabled={busy !== null}
                onClick={() =>
                  void run('delete', () => api.admin.deleteAIKey(), (r) => {
                    setS(r);
                    setTest(null);
                    setConfirmDelete(false);
                    setMsg({ ok: true, text: t('admin.aiSettings.removed') });
                  })
                }
              >
                {t('admin.aiSettings.removeConfirm')}
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => setConfirmDelete(false)}>
                {t('admin.aiSettings.keep')}
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="ai-section ai-explain" aria-labelledby={`${id}-what`}>
        <h2 id={`${id}-what`}>{t('admin.aiSettings.explainTitle')}</h2>
        <div className="ai-explain__cols">
          <div>
            <h3>{t('admin.aiSettings.doesTitle')}</h3>
            <ul>
              {(['search', 'drafts', 'suggestions', 'translation'] as const).map((k) => (
                <li key={k}>{t(`admin.aiSettings.does.${k}`)}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3>{t('admin.aiSettings.doesNotTitle')}</h3>
            <ul>
              {(['publish', 'invent', 'personal', 'decide'] as const).map((k) => (
                <li key={k}>{t(`admin.aiSettings.doesNot.${k}`)}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3>{t('admin.aiSettings.dataTitle')}</h3>
            <ul>
              {(['search', 'drafts', 'suggestions', 'never'] as const).map((k) => (
                <li key={k}>{t(`admin.aiSettings.data.${k}`)}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}
