import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../state/auth';
import { useMeta } from '../state/meta';
import { Icon } from './Icon';
import { LanguageSwitcher } from './LanguageSwitcher';

export function DemoBanner() {
  const { t } = useTranslation();
  const { meta } = useMeta();
  if (!meta?.demo_mode) return null;
  return (
    <div className="demo-banner" role="note">
      <Icon name="flask" size={16} />
      {t('demo.banner')}
    </div>
  );
}

export function Layout() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);

  // Close the mobile menu and move focus to <main> on route change (announces the new page to screen readers).
  useEffect(() => {
    setMenuOpen(false);
    if (location.hash) return;
    mainRef.current?.focus({ preventScroll: true });
    window.scrollTo?.(0, 0);
  }, [location.pathname, location.hash]);

  const onSignOut = async () => {
    await logout();
    navigate('/');
  };

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        {t('nav.skip')}
      </a>
      <DemoBanner />
      <header className="site-header">
        <div className="site-header__inner">
          <Link to="/" className="brand">
            <span className="brand__mark" aria-hidden="true">
              <svg viewBox="0 0 32 32" width="28" height="28">
                <rect width="32" height="32" rx="7" fill="currentColor" />
                <path d="M9 13h14l-2 11H11z" fill="var(--paper)" />
                <circle cx="16" cy="9" r="3" fill="var(--marigold)" />
              </svg>
            </span>
            <span className="brand__text">
              <span className="brand__name">{t('app.shortName')}</span>
              <span className="brand__region">{t('app.region')}</span>
            </span>
          </Link>
          <LanguageSwitcher />
          <button
            type="button"
            className="menu-toggle"
            aria-expanded={menuOpen}
            aria-controls="site-nav"
            onClick={() => setMenuOpen((o) => !o)}
          >
            <Icon name="list" />
            <span>{t('nav.menu')}</span>
          </button>
          <nav id="site-nav" className={`site-nav ${menuOpen ? 'is-open' : ''}`} aria-label={t('nav.primary')}>
            <ul>
              <li>
                <NavLink to="/find">{t('nav.find')}</NavLink>
              </li>
              <li>
                <NavLink to="/about">{t('nav.about')}</NavLink>
              </li>
              {user && (
                <li>
                  <NavLink to="/favorites">{t('nav.favorites')}</NavLink>
                </li>
              )}
              {user?.role === 'admin' && (
                <li>
                  <NavLink to="/admin">{t('nav.admin')}</NavLink>
                </li>
              )}
              {user ? (
                <>
                  <li>
                    <NavLink to="/account">{t('nav.account')}</NavLink>
                  </li>
                  <li>
                    <button type="button" className="linklike" onClick={() => void onSignOut()}>
                      {t('nav.signOut')}
                    </button>
                  </li>
                </>
              ) : (
                <li>
                  <NavLink to="/login">{t('nav.signIn')}</NavLink>
                </li>
              )}
            </ul>
          </nav>
        </div>
      </header>
      <main id="main" ref={mainRef} tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="site-footer">
        <div className="site-footer__inner">
          <p>{t('footer.disclaimer')}</p>
          <p>
            <Link to="/about">{t('footer.about')}</Link> · <Link to="/about#privacy">{t('footer.privacy')}</Link>
          </p>
          <p className="muted">{t('footer.mapCredit')}</p>
        </div>
      </footer>
    </div>
  );
}
