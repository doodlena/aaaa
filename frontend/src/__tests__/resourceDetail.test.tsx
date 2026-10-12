import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { ResourceDetail } from '../api/types';
import i18n from '../i18n';
import { ResourcePage } from '../pages/ResourcePage';
import { mockFetch, renderApp, summary } from '../test/utils';

function detail(overrides: Partial<ResourceDetail> = {}): ResourceDetail {
  return {
    ...summary({
      id: 5,
      name: '[TEST] Birch Hill Church Pantry',
      website: null,
      eligibility: {
        photo_id: 'unknown',
        proof_of_address: 'unknown',
        income_documentation: 'unknown',
        appointment: 'unknown',
        residency: 'required',
        referral: 'unknown',
        registration: 'unknown',
        student_affiliation: 'unknown',
      },
    }),
    organization: { name: '[TEST] Birch Hill Church', public_name: null, website: null, phone: null, description: 'We share food every week.', description_lang: 'en' },
    location_website: null,
    email: null,
    registration_url: null,
    accessibility: { wheelchair_accessible: 'unknown', notes: null, parking: null, transit: null, entrance: null },
    notes: null,
    notes_lang: null,
    services: [
      {
        id: 12, service_type: 'pantry_pickup', description: 'Groceries on Saturdays.', description_lang: 'en', offering_status: 'regular', frequency: null,
        appointment_required: 'unknown', registration_required: 'unknown', household_limit: null, visit_limit: null, notes: null,
        food_types: ['general_groceries'], last_verified_at: null,
      },
    ],
    eligibility_details: [
      { requirement_type: 'residency', status: 'required', details: 'Fairfax County residents', values: {}, scope: 'location', service_id: null, verified_at: null },
    ],
    schedules: {
      distribution: [{ weekday: 5, opens: '09:00', closes: '11:00', week_of_month: -1, valid_from: null, valid_to: null, appointment_only: false, notes: null, service_id: 12 }],
      operating_hours: [],
    },
    upcoming_windows: [],
    exceptions: [],
    events: [],
    current_inventory: null,
    sources: [{ source_id: 'synthetic-fixtures', name: 'Synthetic fixtures', url: 'https://example.org/syn', last_seen_at: '2026-10-01T00:00:00Z', is_synthetic: true }],
    translations: {
      'service:12:description': { text: 'Comestibles los sábados.', is_machine: true, reviewed: false },
    },
    directions: {
      osm: 'https://www.openstreetmap.org/directions?route=%3B38.86%2C-77.099',
      apple: 'https://maps.apple.com/?daddr=38.86,-77.099',
      google: 'https://www.google.com/maps/dir/?api=1&destination=38.86,-77.099',
      geo: 'geo:38.86,-77.099',
    },
    ...overrides,
  };
}

describe('Resource detail', () => {
  it('renders unknown eligibility as "Not confirmed", never as not required', async () => {
    mockFetch([{ path: '/api/resources/5', body: detail() }, { path: '/api/resources/5/visit-plan', body: { checklist: [], suggestions: [], next_windows: [] } }]);
    renderApp(<ResourcePage />, { route: '/resource/5', path: '/resource/:id' });
    const table = await screen.findByRole('table', { name: 'Requirements and their status' });
    const photoRow = within(table).getByRole('row', { name: /Photo ID/ });
    expect(photoRow).toHaveTextContent('Not confirmed');
    expect(photoRow).not.toHaveTextContent('Not required');
    expect(photoRow.querySelector('.tri--unknown')).not.toBeNull();
    const residency = within(table).getByRole('row', { name: /Must live in a certain area/ });
    expect(residency).toHaveTextContent('Required');
    expect(residency).toHaveTextContent('Fairfax County residents');
    expect(within(table).queryByText('Not required (confirmed)')).toBeNull();
    expect(screen.getByText(/does not mean there is no requirement/i)).toBeInTheDocument();
  });

  it('shows directions, sources, unknown website, caveats, schedule rules and the test-data badge', async () => {
    mockFetch([{ path: '/api/resources/5', body: detail() }, { path: '/api/resources/5/visit-plan', body: { checklist: [], suggestions: [], next_windows: [] } }]);
    renderApp(<ResourcePage />, { route: '/resource/5', path: '/resource/:id' });
    const osm = await screen.findByTestId('directions-osm');
    expect(osm).toHaveAttribute('href', expect.stringContaining('openstreetmap.org/directions'));
    expect(screen.getByRole('link', { name: 'Apple Maps' })).toBeInTheDocument();
    expect(screen.getAllByText('Official website not known').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /Synthetic fixtures/ })).toHaveAttribute('href', 'https://example.org/syn');
    expect(screen.getByText('Food selection may vary.')).toBeInTheDocument();
    expect(screen.getByText('Current stock has not been confirmed.')).toBeInTheDocument();
    expect(screen.getByText('Last Saturday of the month')).toBeInTheDocument();
    expect(screen.getAllByTestId('synthetic-badge').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /Sign in to save/ })).toHaveAttribute('href', '/login?next=%2Fresource%2F5');
  });

  it('labels machine translations and can show the original', async () => {
    await i18n.changeLanguage('es');
    const { calls } = mockFetch([{ path: '/api/resources/5', body: detail() }, { path: '/api/resources/5/visit-plan', body: { checklist: [], suggestions: [], next_windows: [] } }]);
    renderApp(<ResourcePage />, { route: '/resource/5', path: '/resource/:id' });
    expect(await screen.findByText('Comestibles los sábados.')).toBeInTheDocument();
    expect(screen.getByText('Traducción automática — sin revisar')).toBeInTheDocument();
    expect(calls.find((c) => c.url.pathname === '/api/resources/5')!.url.searchParams.get('lang')).toBe('es');
    expect(screen.getByRole('heading', { name: 'Quién puede recibir ayuda' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Horario' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Ver texto original' }));
    expect(screen.getByText('Groceries on Saturdays.')).toBeInTheDocument();
  });

  it('shows a not-found error from the API', async () => {
    mockFetch([{ path: '/api/resources/5', status: 404, body: { detail: 'Resource not found' } }]);
    renderApp(<ResourcePage />, { route: '/resource/5', path: '/resource/:id' });
    expect(await screen.findByRole('alert')).toHaveTextContent('could not find this listing');
  });
});
