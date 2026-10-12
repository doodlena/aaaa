import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { api } from '../../api/client';
import { Icon } from '../../components/Icon';
import { ErrorMessage, Loading } from '../../components/Status';
import { telHref } from '../../lib/format';
import { useAsync } from '../../lib/useAsync';
import { adminError, StatusPill, When } from './shared';

const CLAIM_TABS = ['pending', 'approved', 'rejected', 'revoked'] as const;
const REPORT_TABS = ['open', 'resolved', 'dismissed'] as const;

/** Pantry staff access requests. Approving gives the person live-posting rights, so confirm them by phone first. */
/** Admin menu badge: how many access requests are waiting (there is no email notification service). */
export function PendingClaimsBadge({ refreshKey }: { refreshKey: string }) {
  const { t } = useTranslation();
  const { data } = useAsync(() => api.admin.pendingClaims(), [refreshKey]);
  if (!data?.pending) return null;
  return (
    <span className="nav-badge" aria-label={t('admin.claims.pendingBadge', { count: data.pending })}>
      {data.pending}
    </span>
  );
}

export function AdminClaims() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<(typeof CLAIM_TABS)[number]>('pending');
  const { data, error, loading, reload } = useAsync(() => api.admin.claims(status), [status]);
  const [msg, setMsg] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const decide = async (id: number, decision: 'approve' | 'reject' | 'revoke', notes?: string) => {
    setMsg(null);
    try {
      const r = await api.admin.decideClaim(id, decision, notes);
      setRejecting(null);
      setReason('');
      setMsg(t('admin.claims.done', { status: t(`portal.claimStatus.${r.status}`, { defaultValue: r.status }) }));
      reload();
    } catch (e) {
      setMsg(adminError(e, t));
    }
  };
  return (
    <div>
      <h1>{t('admin.claims.title')}</h1>
      <p className="notice">
        <Icon name="phone" />
        <span>{t('admin.claims.guidance')}</span>
      </p>
      <div className="tabs" role="group" aria-label={t('admin.claims.filter')}>
        {CLAIM_TABS.map((s) => (
          <button key={s} type="button" className="tab" aria-pressed={status === s} onClick={() => setStatus(s)}>
            {t(`portal.claimStatus.${s}`)}
          </button>
        ))}
      </div>
      <p role="status" className="form-msg">
        {msg}
      </p>
      {loading && !data && <Loading />}
      {!!error && <ErrorMessage error={error} onRetry={reload} />}
      {data && data.items.length === 0 && <p className="muted">{t('admin.none')}</p>}
      {data && data.items.length > 0 && (
        <ul className="proposals">
          {data.items.map((c) => (
            <li key={c.id} className="proposal" data-claim-id={c.id}>
              <p>
                <strong>{c.user_email}</strong> · {c.role_title} · <StatusPill status={c.status} /> · <When at={c.created_at} />
              </p>
              <p>
                {t('admin.claims.forListing')} <Link to={`/admin/resources/${c.location_id}`}>{c.location_name}</Link>
              </p>
              <p>
                {t('admin.claims.listingPhone')}:{' '}
                {c.location_phone ? <a href={telHref(c.location_phone)}>{c.location_phone}</a> : <span className="muted">{t('admin.claims.noPhone')}</span>}
              </p>
              {c.note && <p className="muted">“{c.note}”</p>}
              {c.added_by_staff && <p className="muted">{t('admin.claims.addedByStaff')}</p>}
              {c.decision_note && (
                <p className="muted">
                  {t('admin.claims.noteToRequester')}: “{c.decision_note}”
                </p>
              )}
              {rejecting === c.id && (
                <div className="field">
                  <label htmlFor={`reject-${c.id}`}>{t('admin.claims.rejectReason')}</label>
                  <textarea id={`reject-${c.id}`} rows={2} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
                  <p className="fgroup__hint">{t('admin.claims.rejectReasonHint')}</p>
                  <div className="row-actions">
                    <button type="button" className="btn btn--secondary btn--sm" onClick={() => void decide(c.id, 'reject', reason)}>
                      {t('admin.claims.rejectConfirm')}
                    </button>
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => setRejecting(null)}>
                      {t('common.cancel')}
                    </button>
                  </div>
                </div>
              )}
              <div className="row-actions">
                {c.status === 'pending' && (
                  <>
                    <button type="button" className="btn btn--primary btn--sm" onClick={() => void decide(c.id, 'approve')}>
                      {t('admin.claims.approve')}
                      <span className="visually-hidden"> — {c.user_email}</span>
                    </button>
                    <button type="button" className="btn btn--secondary btn--sm" onClick={() => setRejecting(c.id)}>
                      {t('admin.claims.reject')}
                      <span className="visually-hidden"> — {c.user_email}</span>
                    </button>
                  </>
                )}
                {c.status === 'approved' && (
                  <button type="button" className="btn btn--danger-outline btn--sm" onClick={() => void decide(c.id, 'revoke')}>
                    {t('admin.claims.revoke')}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Anonymous community reports. Several "was closed" / "wrong info" reports return a listing to review automatically. */
export function AdminReports() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<(typeof REPORT_TABS)[number]>('open');
  const { data, error, loading, reload } = useAsync(() => api.admin.reports(status), [status]);
  const [msg, setMsg] = useState<string | null>(null);
  const decide = async (id: number, decision: 'resolve' | 'dismiss') => {
    setMsg(null);
    try {
      await api.admin.decideReport(id, decision);
      setMsg(t('admin.decisionSaved'));
      reload();
    } catch (e) {
      setMsg(adminError(e, t));
    }
  };
  return (
    <div>
      <h1>{t('admin.reports.title')}</h1>
      <p className="muted">{t('admin.reports.lead')}</p>
      <div className="tabs" role="group" aria-label={t('admin.reports.filter')}>
        {REPORT_TABS.map((s) => (
          <button key={s} type="button" className="tab" aria-pressed={status === s} onClick={() => setStatus(s)}>
            {t(`portal.reports.status.${s}`)}
          </button>
        ))}
      </div>
      <p role="status" className="form-msg">
        {msg}
      </p>
      {loading && !data && <Loading />}
      {!!error && <ErrorMessage error={error} onRetry={reload} />}
      {data && data.items.length === 0 && <p className="muted">{t('admin.none')}</p>}
      {data && data.items.length > 0 && (
        <ul className="proposals">
          {data.items.map((r) => (
            <li key={r.id} className="proposal">
              <p>
                <strong>{t(`reports.kind.${r.kind}`, { defaultValue: r.kind })}</strong> · <Link to={`/admin/resources/${r.location_id}`}>{r.location_name}</Link> ·{' '}
                <When at={r.created_at} />
              </p>
              {r.note && <p>“{r.note}”</p>}
              {r.provider_response && (
                <p className="muted">
                  {t('admin.reports.pantryResponse')}: {r.provider_response}
                </p>
              )}
              {r.status === 'open' && (
                <div className="row-actions">
                  <button type="button" className="btn btn--primary btn--sm" onClick={() => void decide(r.id, 'resolve')}>
                    {t('admin.reports.resolve')}
                  </button>
                  <button type="button" className="btn btn--secondary btn--sm" onClick={() => void decide(r.id, 'dismiss')}>
                    {t('admin.reports.dismiss')}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
