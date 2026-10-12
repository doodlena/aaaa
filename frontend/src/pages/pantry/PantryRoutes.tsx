import { Navigate, Route, Routes, useLocation } from 'react-router';
import { Loading } from '../../components/Status';
import { useAuth } from '../../state/auth';
import { PantryDashboard } from './PantryDashboard';
import { PantryHome } from './PantryHome';
import { SurplusBoard } from './SurplusBoard';

/** Pantry portal (/pantry). Requires sign-in; every /api/provider call is authorized server-side per pantry. */
export default function PantryRoutes() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Loading />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return (
    <Routes>
      <Route index element={<PantryHome />} />
      <Route path="surplus" element={<SurplusBoard />} />
      <Route path=":id" element={<PantryDashboard />} />
      <Route path="*" element={<Navigate to="/pantry" replace />} />
    </Routes>
  );
}
