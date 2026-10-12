import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { User } from '../api/types';
import AdminRoutes from '../pages/admin/AdminRoutes';
import PantryRoutes from '../pages/pantry/PantryRoutes';
import { mockFetch, renderApp, testUser } from '../test/utils';

const staff: User = { ...testUser, id: 8, email: 'pantry@example.com' };
const admin: User = { ...testUser, id: 1, email: 'admin@example.org', role: 'admin' };
const approved = {
  membership_id: 1, status: 'approved', role_title: 'Coordinator', location_id: 1, name: '[TEST] Maple', address1: '1 St', city: 'Arlington',
  live: null, open_reports: 0, pending_changes: 0, verification_label: 'source_reported', last_verified_at: null,
};

describe('provider portal: requests', () => {
  it('shows the reviewer note on a declined request and sends it again', async () => {
    document.cookie = 'nfa_csrf=pantry-csrf; path=/';
    const declined = { membership_id: 3, status: 'rejected', role_title: 'Volunteer', location_id: 4, name: '[TEST] Cedar', address1: null, city: null,
      requested_at: '2026-10-01T10:00:00Z', decision_note: "We couldn't reach your office." };
    const { calls } = mockFetch(
      [
        { path: '/api/provider/me', body: { items: [declined], food_types: [] } },
        { method: 'POST', path: '/api/provider/claims', status: 201, body: { id: 3, status: 'pending' } },
      ],
      { user: staff },
    );
    renderApp(<PantryRoutes />, { route: '/pantry', path: '/pantry/*' });
    expect(await screen.findByText("We couldn't reach your office.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Send the request again/ }));
    await userEvent.type(screen.getByLabelText(/role/i), 'Volunteer lead');
    await userEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.pathname === '/api/provider/claims')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({ location_id: 4, role_title: 'Volunteer lead' });
  });

  it('withdraws a pending request', async () => {
    document.cookie = 'nfa_csrf=pantry-csrf; path=/';
    const pending = { membership_id: 2, status: 'pending', role_title: 'Volunteer', location_id: 4, name: '[TEST] Cedar', address1: null, city: null };
    const { calls } = mockFetch(
      [
        { path: '/api/provider/me', body: { items: [pending], food_types: [] } },
        { method: 'DELETE', path: '/api/provider/claims/2', status: 204 },
      ],
      { user: staff },
    );
    renderApp(<PantryRoutes />, { route: '/pantry', path: '/pantry/*' });
    await userEvent.click(await screen.findByRole('button', { name: /Withdraw request/ }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url.pathname === '/api/provider/claims/2')).toBe(true));
  });
});

describe('provider portal: dashboard', () => {
  const routes = [
    { path: '/api/provider/me', body: { items: [approved], food_types: [] } },
    { path: '/api/provider/locations/1/shelf/history', body: { items: [] } },
    { path: '/api/provider/locations/1/staff', body: { items: [{ membership_id: 1, email: 'pantry@example.com', role_title: 'Coordinator', status: 'approved', is_you: true, since: null }] } },
  ];

  it('confirms the listing as correct', async () => {
    document.cookie = 'nfa_csrf=pantry-csrf; path=/';
    const { calls } = mockFetch(
      [
        ...routes,
        {
          method: 'POST',
          path: '/api/provider/locations/1/confirm',
          status: 200,
          body: { verification_label: 'verified', last_verified_at: '2026-10-12T12:00:00Z' },
        },
      ],
      { user: staff },
    );
    renderApp(<PantryRoutes />, { route: '/pantry/1', path: '/pantry/*' });
    await userEvent.type(await screen.findByLabelText(/Note \(what you checked\)/), 'Called the office');
    await userEvent.click(screen.getByRole('button', { name: "Yes, it's all correct" }));
    expect(await screen.findByText(/marked verified as of today/)).toBeInTheDocument();
    expect(calls.find((c) => c.url.pathname === '/api/provider/locations/1/confirm')!.body).toEqual({ notes: 'Called the office' });
  });

  it('shows a clear message when confirmation is blocked by pending corrections', async () => {
    document.cookie = 'nfa_csrf=pantry-csrf; path=/';
    mockFetch(
      [...routes, { method: 'POST', path: '/api/provider/locations/1/confirm', status: 409, body: { detail: 'Resolve pending source changes before verifying' } }],
      { user: staff },
    );
    renderApp(<PantryRoutes />, { route: '/pantry/1', path: '/pantry/*' });
    await userEvent.click(await screen.findByRole('button', { name: "Yes, it's all correct" }));
    expect(await screen.findByText(/Some corrections are still waiting for review/)).toBeInTheDocument();
  });

  it('adds a colleague', async () => {
    document.cookie = 'nfa_csrf=pantry-csrf; path=/';
    const { calls } = mockFetch(
      [
        ...routes,
        {
          method: 'POST',
          path: '/api/provider/locations/1/staff',
          status: 201,
          body: { membership_id: 9, email: 'new@example.org', status: 'approved' },
        },
      ],
      { user: staff },
    );
    renderApp(<PantryRoutes />, { route: '/pantry/1', path: '/pantry/*' });
    await userEvent.type(await screen.findByLabelText('Their account email'), 'new@example.org');
    const role = screen.getAllByLabelText(/role/i).find((el) => el.closest('.staff-add'))!;
    await userEvent.type(role, 'Volunteer');
    await userEvent.click(screen.getByRole('button', { name: 'Add colleague' }));
    expect(await screen.findByText('new@example.org can now post for this listing.')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST' && c.url.pathname.endsWith('/staff'))!.body).toEqual({ email: 'new@example.org', role_title: 'Volunteer' });
  });

  it('explains when a colleague has no account yet', async () => {
    document.cookie = 'nfa_csrf=pantry-csrf; path=/';
    mockFetch([...routes, { method: 'POST', path: '/api/provider/locations/1/staff', status: 404, body: { detail: 'No account' } }], { user: staff });
    renderApp(<PantryRoutes />, { route: '/pantry/1', path: '/pantry/*' });
    await userEvent.type(await screen.findByLabelText('Their account email'), 'nobody@example.org');
    const role = screen.getAllByLabelText(/role/i).find((el) => el.closest('.staff-add'))!;
    await userEvent.type(role, 'Volunteer');
    await userEvent.click(screen.getByRole('button', { name: 'Add colleague' }));
    expect(await screen.findByText(/Ask your colleague to create a free account/)).toBeInTheDocument();
  });
});

describe('admin: access requests', () => {
  it('shows a pending badge and sends the decline reason to the requester', async () => {
    document.cookie = 'nfa_csrf=admin-csrf; path=/';
    const claim = { id: 5, status: 'pending', role_title: 'Volunteer', note: 'Call the office', user_email: 'vol@example.org', location_id: 1,
      location_name: '[TEST] Maple', location_phone: '(555) 010-0001', created_at: '2026-10-12T10:00:00Z' };
    const { calls } = mockFetch(
      [
        { path: '/api/admin/claims/pending-count', body: { pending: 1 } },
        { path: '/api/admin/claims', body: { items: [claim] } },
        { method: 'POST', path: '/api/admin/claims/5/decision', body: { id: 5, status: 'rejected' } },
      ],
      { user: admin },
    );
    renderApp(<AdminRoutes />, { route: '/admin/claims', path: '/admin/*' });
    expect(await screen.findByLabelText('1 request waiting')).toHaveTextContent('1');
    await userEvent.click(await screen.findByRole('button', { name: /^Reject —/ }));
    await userEvent.type(screen.getByLabelText('Reason (shown to the requester)'), 'Please add an office phone');
    await userEvent.click(screen.getByRole('button', { name: 'Decline request' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ decision: 'reject', notes: 'Please add an office phone' });
  });
});

describe('provider contact email', () => {
  it('shows the configured contact on the portal home and on request status', async () => {
    const pending = { membership_id: 2, status: 'pending', role_title: 'Volunteer', location_id: 4, name: '[TEST] Cedar', address1: null, city: null };
    mockFetch([{ path: '/api/provider/me', body: { items: [pending], food_types: [] } }], {
      user: staff,
      features: { contact_email: 'help@example.org' },
    });
    renderApp(<PantryRoutes />, { route: '/pantry', path: '/pantry/*' });
    expect(await screen.findByText(/Need help with your claim\? Email/)).toBeInTheDocument();
    expect(screen.getByText(/Questions or need access\? Email/)).toBeInTheDocument();
    for (const link of screen.getAllByRole('link', { name: 'help@example.org' })) expect(link).toHaveAttribute('href', 'mailto:help@example.org');
  });

  it('renders nothing when no contact email is configured', async () => {
    mockFetch([{ path: '/api/provider/me', body: { items: [], food_types: [] } }], { user: staff, features: { contact_email: null } });
    renderApp(<PantryRoutes />, { route: '/pantry', path: '/pantry/*' });
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByText(/Questions or need access/)).toBeNull();
  });

  it('shows the contact on the signed-out landing page', async () => {
    mockFetch([], { features: { contact_email: 'help@example.org' } });
    renderApp(<PantryRoutes />, { route: '/pantry', path: '/pantry/*' });
    expect(await screen.findByRole('link', { name: 'help@example.org' })).toHaveAttribute('href', 'mailto:help@example.org');
  });
});
