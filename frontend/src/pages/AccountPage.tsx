import { useEffect, useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate } from 'react-router';
import { api } from '../api/client';
import type { SavedPreferences } from '../api/types';
import { errorKey, Loading } from '../components/Status';
import { SUPPORTED_LANGUAGES, type LangCode } from '../i18n';
import { DEFAULT_FILTERS, ELIGIBILITY_FILTERS, FOOD_GROUPS, kmToMiles, RADII, SERVICE_GROUPS, SORTS, toggle } from '../lib/filters';
import { useAuth } from '../state/auth';

export function AccountPage() {
  const { t } = useTranslation();
  const { user, loading, changeLanguage, setUser } = useAuth();
  const navigate = useNavigate();
  const id = useId();
  const [prefs, setPrefs] = useState<SavedPreferences>({});
  const [prefsMsg, setPrefsMsg] = useState<string | null>(null);
  const [delPw, setDelPw] = useState('');
  const [delConfirm, setDelConfirm] = useState(false);
  const [delMsg, setDelMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) setPrefs(user.preferences || {});
  }, [user]);

  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login?next=/account" replace />;

  const savePrefs = async (e: FormEvent) => {
    e.preventDefault();
    setPrefsMsg(null);
    setBusy(true);
    try {
      const u = await api.updatePreferences({ preferences: prefs });
      setUser(u);
      setPrefsMsg(t('account.prefsSaved'));
    } catch (err) {
      setPrefsMsg(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  const deleteAccount = async (e: FormEvent) => {
    e.preventDefault();
    setDelMsg(null);
    if (!delConfirm) return setDelMsg(t('account.deleteConfirmRequired'));
    if (!delPw) return setDelMsg(t('auth.missingFields'));
    setBusy(true);
    try {
      await api.deleteAccount(delPw);
      setUser(null);
      navigate('/?deleted=1');
    } catch (err) {
      const k = errorKey(err);
      setDelMsg(k === 'errors.unauthorized' ? t('account.wrongPassword') : k === 'errors.conflict' ? t('account.adminCannotDelete') : t(k));
    } finally {
      setBusy(false);
    }
  };

  const listField = (key: 'food_groups' | 'service_groups' | 'eligibility', options: readonly string[], labelKey: string, legend: string) => (
    <fieldset className="fgroup">
      <legend>{legend}</legend>
      <div className="checks checks--cols">
        {options.map((o) => (
          <label key={o} className="check">
            <input type="checkbox" checked={(prefs[key] || []).includes(o)} onChange={() => setPrefs((p) => ({ ...p, [key]: toggle(p[key] || [], o) }))} />
            <span>{t(`${labelKey}.${o}`)}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );

  return (
    <div className="page page--narrow">
      <h1>{t('account.title')}</h1>
      <p>{t('account.signedInAs', { email: user.email })}</p>
      <p>
        <Link to="/favorites">{t('nav.favorites')}</Link>
      </p>

      <section className="card-section" aria-labelledby={`${id}-lang`}>
        <h2 id={`${id}-lang`}>{t('account.languageTitle')}</h2>
        <div className="field">
          <label htmlFor={`${id}-langsel`}>{t('account.languageLabel')}</label>
          <select id={`${id}-langsel`} value={user.preferred_language} onChange={(e) => void changeLanguage(e.target.value as LangCode)}>
            {SUPPORTED_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code} lang={l.code}>
                {l.native}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="card-section" aria-labelledby={`${id}-prefs`}>
        <h2 id={`${id}-prefs`}>{t('account.prefsTitle')}</h2>
        <p>{t('account.prefsIntro')}</p>
        <form className="form" onSubmit={savePrefs}>
          <div className="field">
            <label htmlFor={`${id}-radius`}>{t('explorer.radius')}</label>
            <select id={`${id}-radius`} value={prefs.radius_km ?? DEFAULT_FILTERS.radius_km} onChange={(e) => setPrefs((p) => ({ ...p, radius_km: Number(e.target.value) }))}>
              {RADII.map((r) => (
                <option key={r} value={r}>
                  {t('explorer.radiusOption', { miles: kmToMiles(r) })}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor={`${id}-sort`}>{t('explorer.sort')}</label>
            <select id={`${id}-sort`} value={prefs.sort ?? 'distance'} onChange={(e) => setPrefs((p) => ({ ...p, sort: e.target.value }))}>
              {SORTS.map((s) => (
                <option key={s} value={s}>
                  {t(`sort.${s}`)}
                </option>
              ))}
            </select>
          </div>
          {listField('food_groups', FOOD_GROUPS, 'foodGroup', t('filters.foodGroups'))}
          {listField('service_groups', SERVICE_GROUPS, 'serviceGroup', t('filters.serviceGroups'))}
          {listField('eligibility', ELIGIBILITY_FILTERS, 'eligibilityFilter', t('filters.eligibility'))}
          <label className="check">
            <input type="checkbox" checked={!!prefs.wheelchair} onChange={(e) => setPrefs((p) => ({ ...p, wheelchair: e.target.checked }))} />
            <span>{t('filters.wheelchair')}</span>
          </label>
          <div className="field">
            <label htmlFor={`${id}-lf`}>{t('filters.language')}</label>
            <select id={`${id}-lf`} value={prefs.language_filter ?? ''} onChange={(e) => setPrefs((p) => ({ ...p, language_filter: e.target.value }))}>
              <option value="">{t('filters.languageAny')}</option>
              <option value="es">Español</option>
              <option value="en">English</option>
            </select>
          </div>
          <div className="form__actions">
            <button type="submit" className="btn btn--primary" disabled={busy}>
              {t('account.savePrefs')}
            </button>
            <span role="status" className="form-msg">
              {prefsMsg}
            </span>
          </div>
        </form>
      </section>

      <section className="card-section" aria-labelledby={`${id}-privacy`}>
        <h2 id={`${id}-privacy`}>{t('account.privacyTitle')}</h2>
        <ul className="plain-list">
          <li>{t('account.privacy1')}</li>
          <li>{t('account.privacy2')}</li>
          <li>{t('account.privacy3')}</li>
        </ul>
      </section>

      <section className="card-section card-section--danger" aria-labelledby={`${id}-del`}>
        <h2 id={`${id}-del`}>{t('account.deleteTitle')}</h2>
        <p>{t('account.deleteIntro')}</p>
        <form className="form" onSubmit={deleteAccount}>
          <div className="field">
            <label htmlFor={`${id}-delpw`}>{t('account.deletePassword')}</label>
            <input id={`${id}-delpw`} type="password" autoComplete="current-password" value={delPw} onChange={(e) => setDelPw(e.target.value)} />
          </div>
          <label className="check">
            <input type="checkbox" checked={delConfirm} onChange={(e) => setDelConfirm(e.target.checked)} />
            <span>{t('account.deleteConfirm')}</span>
          </label>
          {delMsg && (
            <p className="form-error" role="alert">
              {delMsg}
            </p>
          )}
          <button type="submit" className="btn btn--danger" disabled={busy}>
            {t('account.deleteButton')}
          </button>
        </form>
      </section>
    </div>
  );
}
