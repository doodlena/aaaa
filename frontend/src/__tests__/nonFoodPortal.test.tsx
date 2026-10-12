import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { User } from '../api/types';
import { mockFetch, renderApp, testUser } from '../test/utils';

vi.mock('../components/MiniMap', () => ({ default: () => <div data-testid="minimap" /> }));
import AdminRoutes from '../pages/admin/AdminRoutes';
import PantryRoutes from '../pages/pantry/PantryRoutes';

/** The provider portal serves every kind of service: clinics, legal aid, shelters… not only food pantries. */

const staff: User = { ...testUser, id: 8, email: 'clinic@example.com' };
const clinic = {
  membership_id: 1, status: 'approved', role_title: 'Office manager', location_id: 1, name: '[TEST] Elm Clinic', address1: '1 St', city: 'Arlington',
  offers_food: false, service_types: ['health_clinic', 'dental_care'], live: null, open_reports: 0, pending_changes: 0,
};
const me = { items: [clinic], food_types: ['fresh_vegetables', 'eggs'] };
const posted = (status: string, message: string | null) => ({
  status, message, items: [], posted_at: new Date().toISOString(), expires_at: new Date().toISOString(), source: 'pantry', ai_assisted: false,
});

describe('non-food provider portal', () => {
  it('posts "Today\'s status" (limited + message) without food items or "Out of food"', async () => {
    document.cookie = 'nfa_csrf=clinic-csrf; path=/';
    const { calls } = mockFetch(
      [
        { path: '/api/provider/me', body: me },
        { path: '/api/provider/locations/1/shelf/history', body: { items: [] } },
        { method: 'POST', path: '/api/provider/locations/1/shelf', status: 201, body: posted('limited', 'Walk-ins paused until 2 pm') },
      ],
      { user: staff },
    );
    renderApp(<PantryRoutes />, { route: '/pantry/1', path: '/pantry/*' });
    await screen.findByRole('heading', { level: 1, name: '[TEST] Elm Clinic' });
    expect(screen.getByText(/walk-ins paused, long wait times/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Out of food' })).toBeNull();
    expect(screen.queryByText("What's on the shelf")).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Limited' }));
    await userEvent.type(screen.getByLabelText(/Short message for families/), 'Walk-ins paused until 2 pm');
    await userEvent.click(screen.getByRole('button', { name: 'Post to families' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.body).toMatchObject({ status: 'limited', message: 'Walk-ins paused until 2 pm', items: [] });
    expect(post.headers['X-CSRF-Token']).toBe('clinic-csrf');
  });

  it('events are "special event or clinic day" with no food offered', async () => {
    document.cookie = 'nfa_csrf=clinic-csrf; path=/';
    const { calls } = mockFetch(
      [
        { path: '/api/provider/me', body: me },
        { path: '/api/provider/locations/1/shelf/history', body: { items: [] } },
        { method: 'POST', path: '/api/provider/locations/1/events', status: 201, body: { id: 4 } },
      ],
      { user: staff },
    );
    renderApp(<PantryRoutes />, { route: '/pantry/1', path: '/pantry/*' });
    await screen.findByRole('heading', { level: 1, name: '[TEST] Elm Clinic' });
    await userEvent.click(screen.getByRole('button', { name: 'Special event or clinic day' }));
    expect(screen.getByRole('heading', { level: 3, name: 'Special event or clinic day' })).toBeInTheDocument();
    expect(screen.getByText(/vaccine clinic, legal-aid day/)).toBeInTheDocument();
    expect(screen.queryByText('Food offered')).toBeNull();
    await userEvent.type(screen.getByLabelText('Event name'), 'Free flu shots');
    await userEvent.type(screen.getByLabelText('Date'), '2030-01-05');
    await userEvent.type(screen.getByLabelText('Starts'), '10:00');
    await userEvent.click(screen.getByRole('button', { name: 'Post event' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({ title: 'Free flu shots', offerings: [] });
  });

  it('proposes category changes (grouped, labelled) and opening hours for review', async () => {
    document.cookie = 'nfa_csrf=clinic-csrf; path=/';
    const { calls } = mockFetch(
      [
        { path: '/api/provider/me', body: me },
        { path: '/api/provider/locations/1/shelf/history', body: { items: [] } },
        { method: 'POST', path: '/api/provider/locations/1/change-requests', status: 201, body: { change_proposal_ids: [9], status: 'pending_review' } },
      ],
      { user: staff },
    );
    renderApp(<PantryRoutes />, { route: '/pantry/1', path: '/pantry/*' });
    await screen.findByRole('heading', { level: 1, name: '[TEST] Elm Clinic' });
    await userEvent.click(screen.getByRole('button', { name: 'Suggest a correction' }));
    const picker = screen.getByRole('group', { name: 'Services offered here' });
    expect(within(picker).getByText('Health care')).toBeInTheDocument(); // group label
    expect(within(picker).getByRole('checkbox', { name: 'Health clinic' })).toBeChecked();
    expect(screen.getByText('Weekly opening hours')).toBeInTheDocument();
    await userEvent.click(within(picker).getByRole('checkbox', { name: 'Dental care' }));
    await userEvent.click(within(picker).getByText('Legal and immigration'));
    await userEvent.click(within(picker).getByRole('checkbox', { name: 'Legal aid' }));
    expect(within(picker).getByText(/Sending for review: add Legal aid, remove Dental care/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: /Propose new weekly hours/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Send for review' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    const body = calls.find((c) => c.method === 'POST')!.body as Record<string, unknown>;
    expect(body).toMatchObject({ add_service_types: ['legal_aid'], remove_service_types: ['dental_care'] });
    expect((body.schedules as { kind: string }[])[0].kind).toBe('operating_hours');
    expect(await screen.findByText(/Sent for review/)).toBeInTheDocument();
  });

  it('home hides the food surplus board for non-food providers', async () => {
    mockFetch([{ path: '/api/provider/me', body: me }], { user: staff });
    renderApp(<PantryRoutes />, { route: '/pantry', path: '/pantry/*' });
    expect(await screen.findByRole('link', { name: '[TEST] Elm Clinic' })).toBeInTheDocument();
    expect(screen.queryByText(/Surplus board/)).toBeNull();
  });
});

describe('admin review of a category change', () => {
  it('shows the added and removed categories with their labels', async () => {
    const admin: User = { ...testUser, id: 1, email: 'admin@example.com', role: 'admin' };
    const cp = {
      id: 31, location_id: 1, field: 'service_types', origin: 'provider', current_value: ['dental_care', 'health_clinic'],
      proposed_value: { add: ['legal_aid'], remove: ['dental_care'] }, source_record_id: null, status: 'pending', created_at: '2026-10-10T00:00:00Z', decided_at: null,
    };
    mockFetch(
      [
        { path: '/api/admin/changes', body: { items: [cp] } },
        { path: '/api/admin/duplicates', body: { items: [] } },
      ],
      { user: admin },
    );
    renderApp(<AdminRoutes />, { route: '/admin/conflicts', path: '/admin/*' });
    const row = (await screen.findByRole('rowheader', { name: 'Service categories' })).closest('tr')!;
    const cells = within(row).getAllByRole('cell');
    expect(cells[1]).toHaveTextContent('Current categories');
    expect(cells[1]).toHaveTextContent('Health clinic (Health care)');
    expect(cells[2]).toHaveTextContent(/Add\s*Legal aid \(Legal and immigration\)\s*Remove\s*Dental care \(Health care\)/);
    expect(row).not.toHaveTextContent('"add"');
  });
});
