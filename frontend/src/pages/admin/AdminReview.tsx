import { lazy, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { api } from '../../api/client';
import type { ReviewDetail } from '../../api/types';
import { SyntheticBadge, TriChip, VerificationBadge } from '../../components/Badges';
import { scheduleRule } from '../../components/ResourceDetail';
import { ErrorMessage, Loading } from '../../components/Status';
import { formatAddress, formatTimeRange, safeUrl } from '../../lib/format';
import { useAsync } from '../../lib/useAsync';
import { AdminEditForm } from './AdminEditForm';
import { adminError, Json, renderValue, StatusPill, When } from './shared';

const MiniMap = lazy(() => import('../../components/MiniMap'));

const METHODS = ['phone', 'email', 'website', 'in_person', 'official_source', 'provider_submission'] as const;
const ACTIONS = ['verify', 'publish', 'unpublish', 'reject', 'flag', 'close_temporary', 'close_permanent', 'reopen'] as const;
type Action = (typeof ACTIONS)[number];

function ActionBar({ r, onDone }: { r: ReviewDetail; onDone: (msg: string) => void }) {
  const { t } = useTranslation();
  const [method, setMethod] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirming, setConfirming] = useState<Action | null>(null);
  const destructive: Action[] = ['reject', 'close_permanent', 'unpublish'];

  const run = async (action: Action) => {
    if (action === 'verify' && !method) {
      setMsg({ ok: false, text: t('admin.methodRequired') });
      return;
    }
    if (destructive.includes(action) && confirming !== action) {
      setConfirming(action);
      return;
    }
    setConfirming(null);
    setBusy(true);
    setMsg(null);
    try {
      const res = await api.admin.action(r.id, action, action === 'verify' ? method : method || 'none', notes);
      const text = t('admin.actionDone', { action: t(`admin.action.${action}`), status: t(`reviewStatus.${res.review_status}`) });
      setMsg({ ok: true, text });
      setNotes('');
      onDone(text);
    } catch (e) {
      setMsg({ ok: false, text: adminError(e, t) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="actionbar" aria-labelledby="actions-title">
      <h2 id="actions-title">{t('admin.actions')}</h2>
      <div className="actionbar__fields">
        <div className="field">
          <label htmlFor="vmethod">{t('admin.method')}</label>
          <select id="vmethod" value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="">{t('admin.methodPick')}</option>
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {t(`admin.methods.${m}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="field field--grow">
          <label htmlFor="vnotes">{t('admin.notes')}</label>
          <input id="vnotes" type="text" value={notes} maxLength={4000} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
      <div className="actionbar__buttons">
        {ACTIONS.map((a) => (
          <button
            key={a}
            type="button"
            className={`btn ${a === 'verify' || a === 'publish' ? 'btn--primary' : destructive.includes(a) ? 'btn--danger-outline' : 'btn--secondary'}`}
            disabled={busy}
            onClick={() => void run(a)}
          >
            {confirming === a ? t('admin.confirmAction', { action: t(`admin.action.${a}`) }) : t(`admin.action.${a}`)}
          </button>
        ))}
      </div>
      <p className="muted small">{t('admin.verifyHint')}</p>
      <div role="status" aria-live="polite">
        {msg && <p className={msg.ok ? 'form-ok' : 'form-error'}>{msg.text}</p>}
      </div>
    </section>
  );
}

function Issues({ validation }: { validation: unknown }) {
  const { t } = useTranslation();
  if (!Array.isArray(validation) || validation.length === 0) return <p className="muted">{t('admin.noIssues')}</p>;
  return (
    <ul className="issues">
      {validation.map((v, i) => {
        const it = v as { field?: string; code?: string; severity?: string };
        return (
          <li key={i} className={`issue issue--${it.severity || 'warning'}`}>
            <strong>{it.severity === 'error' ? t('admin.error') : t('admin.warning')}</strong> {it.field}: {it.code}
          </li>
        );
      })}
    </ul>
  );
}

export function AdminReview() {
  const { t } = useTranslation();
  const { id } = useParams();
  const { data: r, error, loading, reload } = useAsync(() => api.admin.resource(id!), [id]);
  const [flash, setFlash] = useState<string | null>(null);
  const [decisionMsg, setDecisionMsg] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  if (loading && !r) return <Loading />;
  if (error) return <ErrorMessage error={error} onRetry={reload} />;
  if (!r) return null;

  const website = safeUrl(r.website);
  const decide = async (fn: () => Promise<unknown>) => {
    setDecisionMsg(null);
    try {
      await fn();
      setDecisionMsg(t('admin.decisionSaved'));
      reload();
    } catch (e) {
      setDecisionMsg(adminError(e, t));
    }
  };
  const pendingChanges = r.change_proposals.filter((c) => c.status === 'pending');

  return (
    <div className="review">
      <p>
        <Link to="/admin">← {t('admin.backToQueue')}</Link>
      </p>
      <header className="review__head">
        <div className="card__badges">
          {r.is_synthetic && <SyntheticBadge />}
          <StatusPill status={r.review_status} />
          <span className={`pill ${r.published ? 'pill--verified' : 'pill--candidate'}`}>{r.published ? t('admin.isPublished') : t('admin.notPublished')}</span>
          <span className="pill">{t(`operating.${r.operating_status}`, { defaultValue: r.operating_status })}</span>
          {(r.review_status === 'verified' || r.review_status === 'stale') && <VerificationBadge label={r.verification_label} lastVerifiedAt={r.last_verified_at} />}
        </div>
        <h1>{r.name}</h1>
        <p>
          {r.organization_name} · {formatAddress(r.address) || '—'}
        </p>
        <p className="review__links">
          {website ? (
            <a href={website} target="_blank" rel="noopener noreferrer">
              {t('admin.officialWebsite')}: {website}
            </a>
          ) : (
            <span className="muted">{t('detail.websiteUnknown')}</span>
          )}
          {r.published && (
            <>
              {' · '}
              <Link to={`/resource/${r.id}`}>{t('admin.viewPublic')}</Link>
            </>
          )}
        </p>
        {flash && (
          <p className="form-ok" role="status">
            {flash}
          </p>
        )}
      </header>

      <ActionBar
        r={r}
        onDone={(m) => {
          setFlash(m);
          reload();
        }}
      />

      <div className="review__grid">
        <section aria-labelledby="coords-title" className="review__card">
          <h2 id="coords-title">{t('admin.coordinates')}</h2>
          {r.lat !== null && r.lon !== null ? (
            <>
              <p className="mono">
                {r.lat}, {r.lon}
              </p>
              <Suspense fallback={<Loading label={t('map.loading')} />}>
                <MiniMap lat={r.lat} lon={r.lon} />
              </Suspense>
            </>
          ) : (
            <p className="form-error">{t('admin.noCoordinates')}</p>
          )}
        </section>

        <section aria-labelledby="core-title" className="review__card">
          <h2 id="core-title">{t('admin.coreFields')}</h2>
          <dl className="kvs kvs--compact">
            <div className="kv"><dt>{t('detail.phone')}</dt><dd>{r.phone || '—'}</dd></div>
            <div className="kv"><dt>{t('detail.email')}</dt><dd>{r.email || '—'}</dd></div>
            <div className="kv"><dt>{t('admin.jurisdiction')}</dt><dd>{r.jurisdiction_id || '—'}</dd></div>
            <div className="kv"><dt>{t('detail.wheelchair')}</dt><dd>{r.wheelchair_accessible}</dd></div>
            <div className="kv"><dt>{t('detail.languages')}</dt><dd>{r.languages.join(', ') || '—'}</dd></div>
            <div className="kv"><dt>{t('admin.lastVerified')}</dt><dd><When at={r.last_verified_at} /></dd></div>
          </dl>
        </section>
      </div>

      <section aria-labelledby="edit-title" className="review__section">
        <h2 id="edit-title">{t('admin.edit')}</h2>
        {editing ? (
          <AdminEditForm
            r={r}
            onCancel={() => setEditing(false)}
            onSaved={() => {
              setEditing(false);
              setFlash(t('admin.editSaved'));
              reload();
            }}
          />
        ) : (
          <button type="button" className="btn btn--secondary" onClick={() => setEditing(true)}>
            {t('admin.openEditor')}
          </button>
        )}
      </section>

      <section aria-labelledby="src-title" className="review__section">
        <h2 id="src-title">{t('admin.sourceRecords', { count: r.source_records.length })}</h2>
        {r.source_records.map((s) => {
          const href = safeUrl(s.source_url);
          return (
            <article key={s.id} className="srcrec">
              <h3>
                {s.source_name} <span className="muted small">#{s.id}</span>
                {s.is_synthetic && <SyntheticBadge />}
              </h3>
              <p className="small">
                {href ? (
                  <a href={href} target="_blank" rel="noopener noreferrer">
                    {t('admin.sourceLink')}
                  </a>
                ) : (
                  t('admin.noSourceUrl')
                )}{' '}
                · {t('admin.externalId')}: {s.external_id || '—'} · {t('admin.recordStatus')}: {s.status} · {t('admin.firstSeen')}: <When at={s.first_seen_at} /> ·{' '}
                {t('admin.lastSeen')}: <When at={s.last_seen_at} />
              </p>
              <h4>{t('admin.validation')}</h4>
              <Issues validation={s.validation} />
              <div className="compare">
                <div>
                  <h4>{t('admin.raw')}</h4>
                  <Json value={s.raw} />
                </div>
                <div>
                  <h4>{t('admin.normalized')}</h4>
                  <Json value={s.normalized} />
                </div>
              </div>
            </article>
          );
        })}
      </section>

      <section aria-labelledby="prov-title" className="review__section">
        <h2 id="prov-title">{t('admin.provenance')}</h2>
        {r.field_provenance.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t('admin.field')}</th>
                  <th scope="col">{t('admin.value')}</th>
                  <th scope="col">{t('admin.sourceRecord')}</th>
                  <th scope="col">{t('admin.observed')}</th>
                </tr>
              </thead>
              <tbody>
                {r.field_provenance.map((f, i) => (
                  <tr key={i}>
                    <th scope="row">{f.field}</th>
                    <td className="mono small">{renderValue(f.value)}</td>
                    <td>{f.source_record_id ? `#${f.source_record_id}` : '—'}</td>
                    <td>
                      <When at={f.observed_at} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">{t('admin.none')}</p>
        )}
      </section>

      <section aria-labelledby="cp-title" className="review__section">
        <h2 id="cp-title">{t('admin.changeProposals', { count: pendingChanges.length })}</h2>
        <div role="status">{decisionMsg && <p className="form-msg">{decisionMsg}</p>}</div>
        {r.change_proposals.length ? (
          <ul className="proposals">
            {r.change_proposals.map((c) => (
              <li key={c.id} className="proposal">
                <p>
                  <strong>{c.field}</strong> · <StatusPill status={c.status} /> · <When at={c.created_at} />
                  {c.source_record_id && <span className="muted"> · {t('admin.sourceRecord')} #{c.source_record_id}</span>}
                </p>
                <div className="compare">
                  <div>
                    <h4>{t('admin.current')}</h4>
                    <pre className="json">{renderValue(c.current_value)}</pre>
                  </div>
                  <div>
                    <h4>{t('admin.proposed')}</h4>
                    <pre className="json json--proposed">{renderValue(c.proposed_value)}</pre>
                  </div>
                </div>
                {c.status === 'pending' && (
                  <div className="row-actions">
                    <button type="button" className="btn btn--primary btn--sm" onClick={() => void decide(() => api.admin.decideChange(c.id, 'accept'))}>
                      {t('admin.accept')}
                    </button>
                    <button type="button" className="btn btn--secondary btn--sm" onClick={() => void decide(() => api.admin.decideChange(c.id, 'reject'))}>
                      {t('admin.rejectChange')}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">{t('admin.none')}</p>
        )}
      </section>

      <section aria-labelledby="dup-title" className="review__section">
        <h2 id="dup-title">{t('admin.duplicates')}</h2>
        {r.duplicates.length ? (
          <ul className="proposals">
            {r.duplicates.map((d) => (
              <li key={d.id} className="proposal">
                <p>
                  {t('admin.score')}: <strong>{d.score}</strong> · <StatusPill status={d.status} /> · {t('admin.reasons')}: {renderValue(d.reasons)}
                </p>
                <div className="compare">
                  <div>
                    <h4>{t('admin.existing')}</h4>
                    <p>
                      <Link to={`/admin/resources/${d.location_id}`}>{d.location_name}</Link>
                      <br />
                      {d.location_address}
                    </p>
                  </div>
                  <div>
                    <h4>
                      {t('admin.incoming')} {d.incoming_source && <span className="muted">({d.incoming_source})</span>}
                    </h4>
                    {d.other_location_id && (
                      <p>
                        <Link to={`/admin/resources/${d.other_location_id}`}>#{d.other_location_id}</Link>
                      </p>
                    )}
                    {d.incoming && <Json value={d.incoming} />}
                  </div>
                </div>
                {d.status === 'pending' && (
                  <div className="row-actions">
                    <button type="button" className="btn btn--primary btn--sm" onClick={() => void decide(() => api.admin.decideDuplicate(d.id, 'merge'))}>
                      {t('admin.merge')}
                    </button>
                    <button type="button" className="btn btn--secondary btn--sm" onClick={() => void decide(() => api.admin.decideDuplicate(d.id, 'distinct'))}>
                      {t('admin.distinct')}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">{t('admin.none')}</p>
        )}
      </section>

      <section aria-labelledby="svc-title" className="review__section">
        <h2 id="svc-title">{t('admin.servicesEtc')}</h2>
        <h3>{t('admin.services')}</h3>
        <ul className="plain-list">
          {r.services.map((s) => (
            <li key={s.id}>
              <strong>{t(`serviceType.${s.service_type}`, { defaultValue: s.service_type })}</strong> ({t(`offering.${s.offering_status}`)}) —{' '}
              {s.food_types.map((f) => t(`foodType.${f}`)).join(', ') || '—'}
              {s.description && <div className="small">{s.description}</div>}
            </li>
          ))}
        </ul>
        <h3>{t('detail.eligibility')}</h3>
        <ul className="plain-list">
          {r.eligibility_details.map((e, i) => (
            <li key={i}>
              {t(`requirement.${e.requirement_type}`, { defaultValue: e.requirement_type })}: <TriChip state={e.status} /> {e.details}
              {e.scope === 'service' && <span className="muted"> ({t('admin.serviceScoped')} #{e.service_id})</span>}
            </li>
          ))}
          {!r.eligibility_details.length && <li className="muted">{t('admin.none')}</li>}
        </ul>
        <h3>{t('detail.schedule')}</h3>
        <ul className="plain-list">
          {[...r.schedules.distribution.map((s) => ({ s, k: 'distribution' })), ...r.schedules.operating_hours.map((s) => ({ s, k: 'operating_hours' }))].map(
            ({ s, k }, i) => (
              <li key={i}>
                <span className="muted">{t(`admin.scheduleKind.${k}`)}:</span> {scheduleRule(s, t, 'en')} {formatTimeRange(s.opens, s.closes, 'en')}
              </li>
            ),
          )}
        </ul>
      </section>

      <section aria-labelledby="hist-title" className="review__section">
        <h2 id="hist-title">{t('admin.history')}</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('admin.when')}</th>
                <th scope="col">{t('admin.actionCol')}</th>
                <th scope="col">{t('admin.method')}</th>
                <th scope="col">{t('admin.reviewer')}</th>
                <th scope="col">{t('admin.notes')}</th>
              </tr>
            </thead>
            <tbody>
              {r.verification_history.map((v) => (
                <tr key={v.id}>
                  <td><When at={v.created_at} /></td>
                  <td>{t(`admin.action.${v.action}`, { defaultValue: v.action })}</td>
                  <td>{v.method && v.method !== 'none' ? t(`admin.methods.${v.method}`, { defaultValue: v.method }) : '—'}</td>
                  <td>{v.reviewer}</td>
                  <td>{v.notes || '—'}</td>
                </tr>
              ))}
              {!r.verification_history.length && (
                <tr>
                  <td colSpan={5} className="muted">{t('admin.none')}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <h3>{t('admin.audit')}</h3>
        <details>
          <summary>{t('admin.auditCount', { count: r.audit.length })}</summary>
          <ul className="plain-list">
            {r.audit.map((a, i) => (
              <li key={i}>
                <When at={a.at} /> · {a.actor || '—'} · <strong>{a.action}</strong>
                <div className="compare">
                  <Json value={a.before} />
                  <Json value={a.after} />
                </div>
              </li>
            ))}
          </ul>
        </details>
      </section>
    </div>
  );
}
