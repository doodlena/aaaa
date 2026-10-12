import { useTranslation } from 'react-i18next';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router';
import { Loading } from '../../components/Status';
import { useAuth } from '../../state/auth';
import { AdminAI } from './AdminAI';
import { AdminClaims, AdminReports, PendingClaimsBadge } from './AdminClaimsReports';
import { AdminConflicts } from './AdminConflicts';
import { AdminQuality } from './AdminQuality';
import { AdminQueue } from './AdminQueue';
import { AdminReview } from './AdminReview';
import { AdminRuns } from './AdminRuns';
import { AdminSources } from './AdminSources';

/**
 * Client-side guard only improves UX: every /api/admin call is still authorized server-side (401/403 are surfaced by
 * each page's error state).
 */
export default function AdminRoutes() {
  const { t } = useTranslation();
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Loading />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (user.role !== 'admin') {
    return (
      <div className="page page--narrow">
        <h1>{t('admin.forbiddenTitle')}</h1>
        <p>{t('errors.forbidden')}</p>
      </div>
    );
  }
  return (
    <div className="admin">
      <nav className="admin__nav" aria-label={t('admin.navLabel')}>
        <ul>
          <li>
            <NavLink to="/admin" end>
              {t('admin.queue')}
            </NavLink>
          </li>
          <li>
            <NavLink to="/admin/claims">
              {t('admin.claims.nav')} <PendingClaimsBadge refreshKey={location.pathname} />
            </NavLink>
          </li>
          <li>
            <NavLink to="/admin/reports">{t('admin.reports.nav')}</NavLink>
          </li>
          <li>
            <NavLink to="/admin/conflicts">{t('admin.conflicts')}</NavLink>
          </li>
          <li>
            <NavLink to="/admin/runs">{t('admin.runs')}</NavLink>
          </li>
          <li>
            <NavLink to="/admin/sources">{t('admin.sources')}</NavLink>
          </li>
          <li>
            <NavLink to="/admin/quality">{t('admin.quality')}</NavLink>
          </li>
          <li>
            <NavLink to="/admin/ai">{t('admin.aiSettings.nav')}</NavLink>
          </li>
        </ul>
      </nav>
      <div className="admin__main">
        <Routes>
          <Route index element={<AdminQueue />} />
          <Route path="resources/:id" element={<AdminReview />} />
          <Route path="claims" element={<AdminClaims />} />
          <Route path="reports" element={<AdminReports />} />
          <Route path="conflicts" element={<AdminConflicts />} />
          <Route path="runs" element={<AdminRuns />} />
          <Route path="sources" element={<AdminSources />} />
          <Route path="quality" element={<AdminQuality />} />
          <Route path="ai" element={<AdminAI />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </div>
    </div>
  );
}
