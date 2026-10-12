import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { api } from '../../api/client';
import { ErrorMessage, Loading } from '../../components/Status';
import { useAsync } from '../../lib/useAsync';
import { useAI } from '../../state/meta';
import type { DuplicateAIOpinion } from '../../api/types';
import { adminError, renderValue, When } from './shared';

/** All pending change proposals and duplicate candidates across resources. */
export function AdminConflicts() {
  const { t } = useTranslation();
  const changes = useAsync(() => api.admin.changes('pending'), []);
  const dups = useAsync(() => api.admin.duplicates('pending'), []);
  const [msg, setMsg] = useState<string | null>(null);

  const decide = async (fn: () => Promise<unknown>, reload: () => void) => {
    setMsg(null);
    try {
      await fn();
      setMsg(t('admin.decisionSaved'));
      reload();
    } catch (e) {
      setMsg(adminError(e, t));
    }
  };

  return (
    <div>
      <h1>{t('admin.conflictsTitle')}</h1>
      <div role="status">{msg && <p className="form-msg">{msg}</p>}</div>

      <h2>{t('admin.changeProposals', { count: changes.data?.items.length ?? 0 })}</h2>
      {changes.loading && !changes.data ? (
        <Loading />
      ) : changes.error ? (
        <ErrorMessage error={changes.error} onRetry={changes.reload} />
      ) : changes.data?.items.length ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('admin.resource')}</th>
                <th scope="col">{t('admin.field')}</th>
                <th scope="col">{t('admin.current')}</th>
                <th scope="col">{t('admin.proposed')}</th>
                <th scope="col">{t('admin.when')}</th>
                <th scope="col">{t('admin.decision')}</th>
              </tr>
            </thead>
            <tbody>
              {changes.data.items.map((c) => (
                <tr key={c.id}>
                  <td><Link to={`/admin/resources/${c.location_id}`}>#{c.location_id}</Link></td>
                  <th scope="row">{c.field}</th>
                  <td><pre className="json">{renderValue(c.current_value)}</pre></td>
                  <td><pre className="json json--proposed">{renderValue(c.proposed_value)}</pre></td>
                  <td><When at={c.created_at} /></td>
                  <td className="row-actions">
                    <button type="button" className="btn btn--primary btn--sm" onClick={() => void decide(() => api.admin.decideChange(c.id, 'accept'), changes.reload)}>
                      {t('admin.accept')}
                    </button>
                    <button type="button" className="btn btn--secondary btn--sm" onClick={() => void decide(() => api.admin.decideChange(c.id, 'reject'), changes.reload)}>
                      {t('admin.rejectChange')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">{t('admin.none')}</p>
      )}

      <h2>{t('admin.duplicates')}</h2>
      {dups.loading && !dups.data ? (
        <Loading />
      ) : dups.error ? (
        <ErrorMessage error={dups.error} onRetry={dups.reload} />
      ) : dups.data?.items.length ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('admin.existing')}</th>
                <th scope="col">{t('admin.incoming')}</th>
                <th scope="col">{t('admin.score')}</th>
                <th scope="col">{t('admin.reasons')}</th>
                <th scope="col">{t('admin.decision')}</th>
              </tr>
            </thead>
            <tbody>
              {dups.data.items.map((d) => (
                <tr key={d.id}>
                  <th scope="row">
                    <Link to={`/admin/resources/${d.location_id}`}>{d.location_name}</Link>
                    <div className="small muted">{d.location_address}</div>
                  </th>
                  <td>
                    {d.other_location_id ? <Link to={`/admin/resources/${d.other_location_id}`}>#{d.other_location_id}</Link> : null}
                    {d.incoming && <pre className="json">{renderValue(d.incoming)}</pre>}
                  </td>
                  <td>{d.score}</td>
                  <td className="small">{renderValue(d.reasons)}</td>
                  <td className="row-actions">
                    <AIOpinion id={d.id} />
                    <button type="button" className="btn btn--primary btn--sm" onClick={() => void decide(() => api.admin.decideDuplicate(d.id, 'merge'), dups.reload)}>
                      {t('admin.merge')}
                    </button>
                    <button type="button" className="btn btn--secondary btn--sm" onClick={() => void decide(() => api.admin.decideDuplicate(d.id, 'distinct'), dups.reload)}>
                      {t('admin.distinct')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">{t('admin.none')}</p>
      )}
    </div>
  );
}

/** Advisory AI comparison of a duplicate pair (cached server-side; the reviewer still decides). */
function AIOpinion({ id }: { id: number }) {
  const { t } = useTranslation();
  const aiFeatures = useAI();
  const [op, setOp] = useState<DuplicateAIOpinion | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!aiFeatures?.structure_suggestions) return null;
  if (op)
    return (
      <div className="small" data-testid="dup-ai-opinion">
        <strong>{t(`admin.dupAI.verdict.${op.verdict}`)}</strong> <span className="muted">({t('admin.dupAI.advisory')})</span>
        <ul>{op.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
      </div>
    );
  return (
    <>
      <button
        type="button"
        className="btn btn--secondary btn--sm"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setErr(null);
          api.admin
            .duplicateAIOpinion(id)
            .then(setOp)
            .catch((e: Error) => setErr(e.message))
            .finally(() => setBusy(false));
        }}
      >
        {busy ? t('admin.dupAI.asking') : t('admin.dupAI.ask')}
      </button>
      {err && <span className="form-error small">{err}</span>}
    </>
  );
}
