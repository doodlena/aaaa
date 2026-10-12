import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { api, ApiError } from '../api/client';
import { errorKey, Loading } from '../components/Status';
import { useAuth } from '../state/auth';
import { useOAuth } from '../state/meta';

/** Only allow same-site relative redirects after sign-in. */
export function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

const OAUTH_FLOW_KEY = 'nfa_oauth_flow';

/**
 * "Continue with <provider>" (shown only when the server has OAuth sign-in configured). Sends the browser to the
 * provider; it returns to /auth/callback. `link` connects the provider to the signed-in account instead of signing in.
 */
export function OAuthButton({ next, link = false }: { next: string; link?: boolean }) {
  const { t } = useTranslation();
  const provider = useOAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!provider) return null;
  const label = provider.name
    ? t(link ? 'account.oauthConnect' : 'auth.oauthContinue', { provider: provider.name })
    : t(link ? 'account.oauthConnectGeneric' : 'auth.oauthContinueGeneric');

  const go = async () => {
    setError(null);
    setBusy(true);
    try {
      const { url } = await api.oauthStart(link);
      try {
        sessionStorage.setItem(OAUTH_FLOW_KEY, JSON.stringify({ next, link }));
      } catch {
        /* storage unavailable: sign-in still works, the redirect goes home */
      }
      window.location.assign(url);
    } catch (err) {
      setError(t(errorKey(err)));
      setBusy(false);
    }
  };

  return (
    <div className="oauth">
      <button type="button" className={`btn btn--secondary ${link ? '' : 'btn--lg'}`} onClick={go} disabled={busy}>
        {label}
      </button>
      {!link && <p className="field__hint">{t('auth.oauthPrivacy')}</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** /auth/callback: the provider sends the browser back here with ?code&state (or ?error). */
export function OAuthCallbackPage() {
  const { t } = useTranslation();
  const { completeOAuth } = useAuth();
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  const code = sp.get('code');
  const state = sp.get('state');

  useEffect(() => {
    if (started.current) return; // the code is single-use; never send it twice
    started.current = true;
    let flow: { next?: string; link?: boolean } = {};
    try {
      flow = JSON.parse(sessionStorage.getItem(OAUTH_FLOW_KEY) || '{}');
      sessionStorage.removeItem(OAUTH_FLOW_KEY);
    } catch {
      /* ignore */
    }
    if (!code || !state) {
      setError(t(sp.get('error') === 'access_denied' ? 'auth.oauthCancelled' : 'auth.oauthFailed'));
      return;
    }
    completeOAuth(code, state)
      .then(() => navigate(safeNext(flow.next ?? null), { replace: true }))
      .catch((err) => {
        const status = err instanceof ApiError ? err.status : 0;
        if (status === 409) setError(t(flow.link ? 'auth.oauthLinkConflict' : 'auth.oauthAccountExists'));
        else if (status === 400 || status === 401 || status === 404) setError(t('auth.oauthFailed'));
        else setError(t(errorKey(err)));
      });
  }, [code, state, sp, completeOAuth, navigate, t]);

  if (!error) return <Loading />;
  return (
    <div className="page page--narrow">
      <h1>{t('auth.signInTitle')}</h1>
      <p className="form-error" role="alert">
        {error}
      </p>
      <p>
        <Link to="/login">{t('auth.oauthBackToSignIn')}</Link>
      </p>
    </div>
  );
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
      <OAuthButton next={safeNext(sp.get('next'))} />
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
      <OAuthButton next={safeNext(sp.get('next'))} />
      <p className="muted">{t('auth.privacyShort')}</p>
      <p>
        {t('auth.haveAccount')} <Link to="/login">{t('auth.signIn')}</Link>
      </p>
    </div>
  );
}
