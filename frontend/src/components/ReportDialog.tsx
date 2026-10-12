import { useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../api/client';
import type { ReportKind } from '../api/types';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { errorKey } from './Status';

export const REPORT_KINDS: ReportKind[] = ['was_closed', 'wrong_info', 'out_of_food', 'other'];
const NOTE_MAX = 500;

/** "Report a problem": anonymous, no account needed. Nothing identifying is stored (the server says so too). */
export function ReportProblem({ id, name }: { id: number; name: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn--ghost" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <Icon name="flag" />
        {t('reports.open')}
      </button>
      {open && <ReportDialog id={id} name={name} onClose={() => setOpen(false)} />}
    </>
  );
}

export function ReportDialog({ id, name, onClose }: { id: number; name: string; onClose: () => void }) {
  const { t } = useTranslation();
  const fid = useId();
  const [kind, setKind] = useState<ReportKind | ''>('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!kind) {
      setError(t('reports.chooseKind'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.report(id, kind, note);
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 429 ? t('reports.rateLimited') : t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t('reports.title')} onClose={onClose}>
      {done ? (
        <div className="report-done" role="status">
          <p className="form-ok">
            <Icon name="check" />
            {t('reports.thanks')}
          </p>
          <p>{t('reports.whatNext')}</p>
          <button type="button" className="btn btn--primary" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="form" noValidate>
          <p className="muted">{t('reports.about', { name })}</p>
          <fieldset className="fgroup">
            <legend>{t('reports.kindLegend')}</legend>
            <div className="checks">
              {REPORT_KINDS.map((k) => (
                <label key={k} className="check">
                  <input type="radio" name={`${fid}-kind`} value={k} checked={kind === k} onChange={() => setKind(k)} />
                  <span>{t(`reports.kind.${k}`)}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="field">
            <label htmlFor={`${fid}-note`}>
              {t('reports.note')} <span className="muted">({t('common.optional')})</span>
            </label>
            <textarea
              id={`${fid}-note`}
              rows={3}
              maxLength={NOTE_MAX}
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))}
              aria-describedby={`${fid}-count ${fid}-privacy`}
            />
            <p id={`${fid}-count`} className="fgroup__hint">
              {t('common.charsLeft', { count: NOTE_MAX - note.length })}
            </p>
          </div>
          <p id={`${fid}-privacy`} className="privacy-note">
            <Icon name="info" size={15} />
            {t('reports.privacy')}
          </p>
          <div aria-live="assertive">{error && <p className="form-error">{error}</p>}</div>
          <div className="form__actions">
            <button type="submit" className="btn btn--primary" disabled={busy}>
              {busy ? t('common.sending') : t('reports.send')}
            </button>
            <button type="button" className="btn btn--ghost" onClick={onClose}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
