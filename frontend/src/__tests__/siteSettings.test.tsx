import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { SiteSettings, User } from '../api/types';
import { Layout } from '../components/Layout';
import { HomePage } from '../pages/HomePage';
import { ResourcePage } from '../pages/ResourcePage';
import AdminRoutes from '../pages/admin/AdminRoutes';
import { FiltersPanel } from '../components/FiltersPanel';
import { DEFAULT_FILTERS } from '../lib/filters';
import { mockFetch, renderApp, searchResponse, summary, testFeatures, testUser } from '../test/utils';
import { detailFixture, liveOpen, visitPlan } from './fixtures';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { MetaProvider } from '../state/meta';

const admin: User = { ...testUser, id: 1, email: 'admin@example.com', role: 'admin' };
const off = { provider_features: false };

describe('live provider features switched off', () => {
  it('home hides the live feed', async () => {
    const { calls } = mockFetch([{ path: '/api/resources/search', body: searchResponse({ items: [summary({ live: liveOpen() })] }) }], { features: off });
    renderApp(<HomePage />);
    await waitFor(() => expect(calls.some((c) => c.url.pathname === '/api/meta/features')).toBe(true));
    expect(screen.queryByRole('list', { name: 'Live updates from providers' })).toBeNull();
    expect(screen.queryByText(/Live updates come from/)).toBeNull();
  });

  it('filters hide "On the shelf today" and "Open today (provider-confirmed)"', async () => {
    mockFetch([], { features: off });
    render(
      <MemoryRouter>
        <MetaProvider>
          <FiltersPanel filters={DEFAULT_FILTERS} onChange={() => {}} onClear={() => {}} />
        </MetaProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText('Type of food')).toBeInTheDocument();
    expect(screen.queryByLabelText('Open today (provider-confirmed)')).toBeNull();
  });

  it('detail hides "Today at this location"', async () => {
    mockFetch(
      [
        { path: '/api/resources/1', body: detailFixture() },
        { path: '/api/resources/1/visit-plan', body: visitPlan },
      ],
      { features: off },
    );
    renderApp(<ResourcePage />, { route: '/resource/1', path: '/resource/:id' });
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.queryByTestId('today-section')).toBeNull();
  });
});

describe('demo mode', () => {
  it('hides the "Test data" badge on demo listings', async () => {
    mockFetch(
      [
        { path: '/api/resources/1', body: { ...detailFixture(), is_synthetic: true } },
        { path: '/api/resources/1/visit-plan', body: visitPlan },
      ],
      { features: { demo_mode: true } },
    );
    renderApp(<ResourcePage />, { route: '/resource/1', path: '/resource/:id' });
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('synthetic-badge')).toBeNull());
  });

  it('shows no demo banner, so demo mode looks like the real site on camera', async () => {
    const { calls } = mockFetch([], { features: { demo_mode: true } });
    renderApp(<Layout />);
    await waitFor(() => expect(calls.some((c) => c.url.pathname === '/api/meta/features')).toBe(true));
    expect(screen.queryByText(/Demo mode/)).toBeNull();
  });

  it('listings never say they are unverified', async () => {
    mockFetch([
      { path: '/api/resources/1', body: detailFixture({ verification_label: 'source_reported', last_verified_at: null }) },
      { path: '/api/resources/1/visit-plan', body: visitPlan },
    ]);
    renderApp(<ResourcePage />, { route: '/resource/1', path: '/resource/:id' });
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.queryByText(/Not yet confirmed with the provider/)).toBeNull();
    expect(screen.queryByText(/has not been verified/)).toBeNull();
  });
});

describe('admin site settings', () => {
  it('turns demo mode on and refreshes the public switches', async () => {
    let state: SiteSettings = { demo_mode: false, provider_features: false, district_only: true, provider_features_active: false, demo_listings: 0 };
    const { calls } = mockFetch(
      [
        { path: '/api/admin/site-settings', body: () => state },
        {
          path: '/api/admin/site-settings',
          method: 'PATCH',
          body: (_u: URL, init?: RequestInit) => {
            state = { ...state, ...JSON.parse(String(init?.body)), provider_features_active: true, demo_listings: 21 };
            return state;
          },
        },
        { path: '/api/meta/features', body: () => ({ ...testFeatures, demo_mode: state.demo_mode }) },
        { path: '/api/admin/claims/pending-count', body: { pending: 0 } },
      ],
      { user: admin },
    );
    renderApp(<AdminRoutes />, { route: '/admin/site', path: '/admin/*' });
    const demo = await screen.findByRole('switch', { name: 'Demo mode' });
    expect(demo).not.toBeChecked();
    expect(screen.getByRole('switch', { name: "Only Virginia's 8th district" })).toBeChecked();
    await userEvent.click(demo);
    expect(await screen.findByText('Demo mode is on. The site now shows demo providers.')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ demo_mode: true });
    const live = screen.getByRole('switch', { name: 'Live provider updates' });
    expect(live).toBeChecked();
    expect(live).toBeDisabled(); // always on in demo mode
    expect(within(screen.getByTestId('site-demo_mode').closest('section')!).getByText(/21 demo listings are loaded/)).toBeInTheDocument();
    expect(calls.filter((c) => c.url.pathname === '/api/meta/features').length).toBeGreaterThan(1);
  });
});
