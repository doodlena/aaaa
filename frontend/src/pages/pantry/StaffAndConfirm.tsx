import { useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../api/client';
import type { ProviderPantry } from '../../api/types';
import { Icon } from '../../components/Icon';
import { ErrorMessage, errorKey } from '../../components/Status';
import { formatDateTime } from '../../lib/format';
import { useAsync } from '../../lib/useAsync';

/**
 * "Everything on this listing is correct": recorded as a verification by this (admin-approved) person, method
 * provider_submission. The server refuses while corrections are still waiting for review.
 */
export function ConfirmListing({ p, onConfirmed }: { p: ProviderPantry; onConfirmed: () => void }) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const confirm = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await api.provider.confirm(p.location_id, notes);
      setNotes('');
      setMsg({ ok: true, text: t('portal.confirm.done') });
      onConfirmed();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError && e.status === 409 ? t('portal.confirm.blocked') : t(errorKey(e)) });
    } finally {
      setBusy(false);
    }
  };
  const verified = p.verification_label === 'verified' && p.last_verified_at;
  return (
    <section className="card-section confirm-listing" aria-labelledby={`${id}-t`}>
      <h2 id={`${id}-t`} className="section-title">
        <Icon name="check" />
        {t('portal.confirm.title')}
      </h2>
      <p className="muted">
        {verified ? t('portal.confirm.lastVerified', { date: formatDateTime(p.last_verified_at!, i18n.language) }) : t('portal.confirm.notYet')}
      </p>
      <p>{t('portal.confirm.lead')}</p>
      {(p.pending_changes || 0) > 0 && <p className="notice">{t('portal.confirm.pendingFirst', { count: p.pending_changes })}</p>}
      <div className="field">
        <label htmlFor={`${id}-n`}>
          {t('portal.confirm.notes')} <span className="muted">({t('common.optional')})</span>
        </label>
        <input id={`${id}-n`} value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={() => void confirm()}>
        {t('portal.confirm.button')}
      </button>
      <div aria-live="polite">{msg && <p className={msg.ok ? 'form-ok' : 'form-error'}>{msg.text}</p>}</div>
    </section>
  );
}

/** Colleagues who can post for this listing. Approved staff add people who already have a free account. */
export function StaffPanel({ locationId }: { locationId: number }) {
  const { t } = useTranslation();
  const id = useId();
  const staff = useAsync(() => api.provider.staff(locationId), [locationId]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.includes('@') || role.trim().length < 2) {
      setMsg({ ok: false, text: t('portal.staff.missing') });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.provider.addStaff(locationId, email.trim(), role.trim());
      setMsg({ ok: true, text: t('portal.staff.added', { email: r.email }) });
      setEmail('');
      setRole('');
      staff.reload();
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      setMsg({ ok: false, text: status === 404 ? t('portal.staff.noAccount') : status === 409 ? t('portal.staff.already') : t(errorKey(err)) });
    } finally {
      setBusy(false);
    }
  };
  const remove = async (membershipId: number) => {
    setMsg(null);
    try {
      await api.provider.removeStaff(locationId, membershipId);
      setRemoving(null);
      staff.reload();
    } catch (err) {
      setMsg({ ok: false, text: t(errorKey(err)) });
    }
  };

  return (
    <section className="card-section staff-panel" aria-labelledby={`${id}-t`}>
      <h2 id={`${id}-t`} className="section-title">
        <Icon name="family" />
        {t('portal.staff.title')}
      </h2>
      {!!staff.error && <ErrorMessage error={staff.error} onRetry={staff.reload} />}
      {staff.data && (
        <ul className="plain-list staff-list">
          {staff.data.items.map((s) => (
            <li key={s.membership_id}>
              <span>
                <strong>{s.email}</strong>
                {s.is_you && <span className="muted"> ({t('portal.staff.you')})</span>}
                <br />
                <span className="muted">
                  {s.role_title}
                  {s.status === 'pending' && ` · ${t('portal.claimStatus.pending')}`}
                </span>
              </span>
              {!s.is_you &&
                (removing === s.membership_id ? (
                  <span className="confirm" role="group" aria-label={t('portal.staff.remove')}>
                    <button type="button" className="btn btn--danger btn--sm" onClick={() => void remove(s.membership_id)}>
                      {t('portal.staff.removeYes')}
                    </button>
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => setRemoving(null)}>
                      {t('common.cancel')}
                    </button>
                  </span>
                ) : (
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => setRemoving(s.membership_id)}>
                    {t('portal.staff.remove')}
                    <span className="visually-hidden"> — {s.email}</span>
                  </button>
                ))}
            </li>
          ))}
        </ul>
      )}
      <form className="form staff-add" onSubmit={add} noValidate>
        <p className="fgroup__hint">{t('portal.staff.howTo')}</p>
        <div className="field">
          <label htmlFor={`${id}-e`}>{t('portal.staff.email')}</label>
          <input id={`${id}-e`} type="email" value={email} maxLength={254} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-r`}>{t('portal.claim.role')}</label>
          <input id={`${id}-r`} value={role} maxLength={120} onChange={(e) => setRole(e.target.value)} placeholder={t('portal.claim.rolePlaceholder')} />
        </div>
        <button type="submit" className="btn btn--secondary btn--sm" disabled={busy}>
          {t('portal.staff.add')}
        </button>
      </form>
      <div aria-live="polite">{msg && <p className={msg.ok ? 'form-ok' : 'form-error'}>{msg.text}</p>}</div>
    </section>
  );
}
