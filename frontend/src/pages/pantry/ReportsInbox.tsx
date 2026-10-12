import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import type { PantryReport } from '../../api/types';
import { Empty, ErrorMessage, errorKey, Loading } from '../../components/Status';
import { formatDateTime } from '../../lib/format';
import { useAsync } from '../../lib/useAsync';

function Respond({ locationId, report, onDone }: { locationId: number; report: PantryReport; onDone: () => void }) {
  const { t } = useTranslation();
  const id = useId();
  const [text, setText] = useState(report.provider_response || '');
  const [resolve, setResolve] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const send = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await api.provider.respondReport(locationId, report.id, text.trim() || null, resolve);
      onDone();
    } catch (e) {
      setMsg(t(errorKey(e)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="respond">
      <div className="field">
        <label htmlFor={`${id}-r`}>{t('portal.reports.response')}</label>
        <textarea id={`${id}-r`} rows={2} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      <label className="check check--sm">
        <input type="checkbox" checked={resolve} onChange={(e) => setResolve(e.target.checked)} />
        <span>{t('portal.reports.markResolved')}</span>
      </label>
      <button type="button" className="btn btn--secondary btn--sm" disabled={busy} onClick={() => void send()}>
        {t('portal.reports.send')}
      </button>
      {msg && <p className="form-error">{msg}</p>}
    </div>
  );
}

/** Community reports about this pantry (anonymous). Staff can respond and mark them resolved. */
export function ReportsInbox({ locationId }: { locationId: number }) {
  const { t, i18n } = useTranslation();
  const { data, error, loading, reload } = useAsync(() => api.provider.reports(locationId), [locationId]);
  return (
    <div>
      <h3>{t('portal.reports.title')}</h3>
      <p className="muted">{t('portal.reports.lead')}</p>
      {loading && !data && <Loading />}
      {!!error && <ErrorMessage error={error} onRetry={reload} />}
      {data && data.items.length === 0 && <Empty title={t('portal.reports.empty')} />}
      {data && data.items.length > 0 && (
        <ul className="inbox">
          {data.items.map((r) => (
            <li key={r.id} className={`inbox__item inbox__item--${r.status}`}>
              <p className="inbox__head">
                <strong>{t(`reports.kind.${r.kind}`, { defaultValue: r.kind })}</strong>
                <span className={`pill pill--${r.status}`}>{t(`portal.reports.status.${r.status}`, { defaultValue: r.status })}</span>
                {r.created_at && <time dateTime={r.created_at}>{formatDateTime(r.created_at, i18n.language)}</time>}
              </p>
              {r.note && <p className="inbox__note">“{r.note}”</p>}
              {r.provider_response && r.status !== 'open' && (
                <p className="muted">
                  {t('portal.reports.yourResponse')}: {r.provider_response}
                </p>
              )}
              {r.status === 'open' && <Respond locationId={locationId} report={r} onDone={reload} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
