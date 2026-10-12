import { useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { errorKey } from '../components/Status';
import { useAuth } from '../state/auth';

/** Only allow same-site relative redirects after sign-in. */
export function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

export function LoginPage() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const id = useId();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password) {
      setError(t('auth.missingFields'));
      return;
    }
    setBusy(true);
    try {
      await login(email.trim(), password);
      navigate(safeNext(sp.get('next')));
    } catch (err) {
      const k = errorKey(err);
      setError(k === 'errors.unauthorized' ? t('auth.badCredentials') : t(k));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page page--narrow">
      <h1>{t('auth.signInTitle')}</h1>
      <p>{t('auth.optionalNote')}</p>
      <form className="form" onSubmit={onSubmit} noValidate aria-describedby={error ? `${id}-err` : undefined}>
        <div className="field">
          <label htmlFor={`${id}-email`}>{t('auth.email')}</label>
          <input id={`${id}-email`} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor={`${id}-pw`}>{t('auth.password')}</label>
          <input id={`${id}-pw`} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {error && (
          <p id={`${id}-err`} className="form-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn--primary btn--lg" disabled={busy}>
          {busy ? t('auth.signingIn') : t('auth.signIn')}
        </button>
      </form>
      <p>
        {t('auth.noAccount')} <Link to={`/register${sp.get('next') ? `?next=${encodeURIComponent(sp.get('next')!)}` : ''}`}>{t('auth.createAccount')}</Link>
      </p>
    </div>
  );
}

export function RegisterPage() {
  const { t } = useTranslation();
  const { register } = useAuth();
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const id = useId();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError(t('auth.invalidEmail'));
    if (password.length < 10) return setError(t('auth.passwordTooShort'));
    if (password !== confirm) return setError(t('auth.passwordMismatch'));
    setBusy(true);
    try {
      await register(email.trim(), password);
      navigate(safeNext(sp.get('next')));
    } catch (err) {
      const k = errorKey(err);
      setError(k === 'errors.conflict' ? t('auth.emailTaken') : k === 'errors.invalid' ? t('auth.invalidEmail') : t(k));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page page--narrow">
      <h1>{t('auth.registerTitle')}</h1>
      <p>{t('auth.registerIntro')}</p>
      <form className="form" onSubmit={onSubmit} noValidate>
        <div className="field">
          <label htmlFor={`${id}-email`}>{t('auth.email')}</label>
          <input id={`${id}-email`} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor={`${id}-pw`}>{t('auth.password')}</label>
          <input
            id={`${id}-pw`}
            type="password"
            autoComplete="new-password"
            aria-describedby={`${id}-pwhint`}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={10}
          />
          <p id={`${id}-pwhint`} className="field__hint">
            {t('auth.passwordHint')}
          </p>
        </div>
        <div className="field">
          <label htmlFor={`${id}-pw2`}>{t('auth.confirmPassword')}</label>
          <input id={`${id}-pw2`} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn--primary btn--lg" disabled={busy}>
          {busy ? t('auth.creating') : t('auth.createAccount')}
        </button>
      </form>
      <p className="muted">{t('auth.privacyShort')}</p>
      <p>
        {t('auth.haveAccount')} <Link to="/login">{t('auth.signIn')}</Link>
      </p>
    </div>
  );
}
