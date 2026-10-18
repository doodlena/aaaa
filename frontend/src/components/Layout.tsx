import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../state/auth';
import { HELP_LINES } from '../lib/helpLines';
import { useContactEmail, useMeta } from '../state/meta';
import { BrandLockup, LanternMark } from './Brand';
import { Icon } from './Icon';
import { OfflineBanner } from './OfflineBanner';
import { LanguageSwitcher } from './LanguageSwitcher';

export function DemoBanner() {
  const { t } = useTranslation();
  const { meta, features } = useMeta();
  if (!meta?.demo_mode && !features?.demo_mode) return null;
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
  const { appName } = useMeta();
  const contactEmail = useContactEmail();
  const location = useLocation();
  // Default title on every route change. A layout effect runs before pages' passive effects, so pages can override it.
  useLayoutEffect(() => {
    document.title = `${appName}: ${t('app.tagline')}`;
  }, [location.pathname, appName, t]);
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
          <Link to="/" className="brand" aria-label={t('nav.home', { app: appName })}>
            <BrandLockup name={appName} tagline={t('app.region')} />
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
                <NavLink to="/pantry">{t('nav.forPantries')}</NavLink>
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
      <OfflineBanner />
      <main id="main" ref={mainRef} tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="site-footer">
        <div className="site-footer__inner">
          <p className="site-footer__brand">
            <LanternMark size={24} /> <strong>{appName}:</strong> {t('app.tagline')}
          </p>
          <p className="site-footer__crisis" data-testid="footer-crisis">
            <Icon name="lifebuoy" size={18} />
            <span>
              {t('footer.crisisLead')}{' '}
              <a href="tel:988">{t('footer.call988')}</a> · <a href="sms:988">{t('footer.text988')}</a> · {t('footer.emergency')}{' '}
              <a href="tel:911">911</a>
            </span>
          </p>
          <p>{t('footer.disclaimer')}</p>
          <p className="site-footer__helplines" data-testid="help-lines">
            <strong>{t('footer.dataWarning')}</strong> {t('footer.helpLead')}{' '}
            {HELP_LINES.map((h, i) => (
              <span key={h.key}>
                {i > 0 && ' · '}
                {t(`footer.helpLine.${h.key}`)} <a href={`tel:${h.tel}`}>{h.label}</a>
              </span>
            ))}
          </p>
          {contactEmail && (
            <p className="site-footer__contact">
              {t('footer.contactLead')} <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
            </p>
          )}
          <p>
            <Link to="/about">{t('footer.about')}</Link> · <Link to="/pantry">{t('footer.forPantries')}</Link> ·{' '}
            <Link to="/about#privacy">{t('footer.privacy')}</Link>
          </p>
          <p className="muted">{t('footer.mapCredit')}</p>
        </div>
      </footer>
    </div>
  );
}
