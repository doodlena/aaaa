import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router';
import { Layout } from './components/Layout';
import { Loading } from './components/Status';
import { AuthProvider } from './state/auth';
import { MetaProvider } from './state/meta';
import { HomePage } from './pages/HomePage';
import { AboutPage } from './pages/AboutPage';
import { LoginPage, RegisterPage } from './pages/AuthPages';
import { AccountPage } from './pages/AccountPage';
import { FavoritesPage } from './pages/FavoritesPage';
import { ResourcePage } from './pages/ResourcePage';
import { NotFoundPage } from './pages/NotFoundPage';

// The explorer pulls in maplibre-gl, and admin is only for reviewers: both are code-split.
const ExplorerPage = lazy(() => import('./pages/ExplorerPage'));
const AdminRoutes = lazy(() => import('./pages/admin/AdminRoutes'));
const PantryRoutes = lazy(() => import('./pages/pantry/PantryRoutes'));

export function App() {
  return (
    <MetaProvider>
      <AuthProvider>
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<HomePage />} />
              <Route path="find" element={<ExplorerPage />} />
              <Route path="resource/:id" element={<ResourcePage />} />
              <Route path="about" element={<AboutPage />} />
              <Route path="login" element={<LoginPage />} />
              <Route path="register" element={<RegisterPage />} />
              <Route path="account" element={<AccountPage />} />
              <Route path="favorites" element={<FavoritesPage />} />
              <Route path="pantry/*" element={<PantryRoutes />} />
              <Route path="admin/*" element={<AdminRoutes />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </Suspense>
      </AuthProvider>
    </MetaProvider>
  );
}
