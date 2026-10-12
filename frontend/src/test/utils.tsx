import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { vi } from 'vitest';
import type { Features, ResourceSummary, SearchResponse, User } from '../api/types';
import { AuthProvider } from '../state/auth';
import { MetaProvider } from '../state/meta';

export interface MockRoute {
  method?: string;
  path: string | RegExp; // matched against pathname + search (without origin)
  status?: number;
  body?: unknown | ((url: URL, init?: RequestInit) => unknown);
}

export interface FetchCall {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body: unknown;
}

/** Install a fetch mock (tests only). Unmatched requests fail loudly with 599. */
export function mockFetch(routes: MockRoute[], opts: { user?: User | null; features?: Partial<Features> } = {}) {
  const calls: FetchCall[] = [];
  const defaults: MockRoute[] = [
    { path: '/api/auth/me', body: { user: opts.user ?? null } },
    { path: '/api/meta/features', body: { ...testFeatures, ...opts.features } },
    { path: '/api/meta/verification', body: { fresh_days: 90, published_by_status: {}, sources: [], demo_mode: false } },
    { path: '/api/jurisdictions', body: [] },
  ];
  const all = [...routes, ...defaults];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const method = (init?.method || 'GET').toUpperCase();
    const headers = (init?.headers || {}) as Record<string, string>;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, headers, body });
    const target = url.pathname + url.search;
    const route = all.find(
      (r) => (r.method || 'GET').toUpperCase() === method && (typeof r.path === 'string' ? url.pathname === r.path : r.path.test(target)),
    );
    if (!route) return new Response(JSON.stringify({ detail: `unmocked ${method} ${target}` }), { status: 599 });
    const payload = typeof route.body === 'function' ? (route.body as (u: URL, i?: RequestInit) => unknown)(url, init) : route.body;
    const status = route.status ?? 200;
    if (status === 204) return new Response(null, { status });
    return new Response(JSON.stringify(payload ?? null), { status, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fn);
  return { fn, calls };
}

export function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname + loc.search}</div>;
}

export function renderApp(ui: ReactElement, { route = '/', path = '*' }: { route?: string; path?: string } = {}) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <MetaProvider>
        <AuthProvider>
          <Routes>
            <Route path={path} element={ui} />
            <Route path="*" element={null} />
          </Routes>
          <LocationProbe />
        </AuthProvider>
      </MetaProvider>
    </MemoryRouter>,
  );
}

export function summary(overrides: Partial<ResourceSummary> = {}): ResourceSummary {
  return {
    id: 1,
    name: '[TEST] Maple Community Pantry',
    organization_name: '[TEST] Maple Org',
    address: { address1: '100 Synthetic Test Rd', address2: null, city: 'Arlington', state: 'VA', zip: '22204' },
    lat: 38.86,
    lon: -77.099,
    distance_km: 1.2,
    jurisdiction_id: 'arlington-county',
    phone: '(555) 010-0001',
    website: null,
    verification_label: 'verified',
    last_verified_at: '2026-10-01T10:00:00Z',
    operating_status: 'open',
    food_types: ['general_groceries'],
    food_groups: ['groceries'],
    service_types: ['pantry_pickup'],
    has_distribution_schedule: true,
    next_distribution: { date: '2026-10-13', opens: '10:00', closes: '13:00', kind: 'distribution', appointment_only: false, title: null },
    distributing_on_date: null,
    eligibility: {
      photo_id: 'not_required',
      proof_of_address: 'unknown',
      income_documentation: 'unknown',
      appointment: 'unknown',
      residency: 'unknown',
      referral: 'unknown',
      registration: 'unknown',
      student_affiliation: 'unknown',
    },
    wheelchair_accessible: 'unknown',
    languages: ['en'],
    warnings: ['synthetic'],
    is_synthetic: true,
    match_reasons: [{ code: 'distance', km: 1.2 }],
    unconfirmed: null,
    live: null,
    open_reports: 0,
    ...overrides,
  };
}

export function searchResponse(overrides: Partial<SearchResponse> = {}): SearchResponse {
  return {
    items: [summary()],
    total: 1,
    page: 1,
    page_size: 25,
    uncertain: [],
    uncertain_total: 0,
    truncated: false,
    coverage: { covered_jurisdictions: [], complete: null },
    ...overrides,
  };
}

export const testUser: User = { id: 7, email: 'person@example.com', role: 'user', preferred_language: 'en', preferences: {} };

export const testFeatures: Features = {
  app_name: 'Lantern',
  demo_mode: false,
  ai: { search: false, announcement_drafts: false, structure_suggestions: false, translation: false, model: null },
};
export const aiOn: Partial<Features> = {
  ai: { search: true, announcement_drafts: true, structure_suggestions: true, translation: false, model: 'test-model' },
};
