import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ReviewDetail, User } from '../api/types';
import { mockFetch, renderApp, summary, testUser } from '../test/utils';

vi.mock('../components/MiniMap', () => ({ default: () => <div data-testid="minimap" /> }));
import AdminRoutes from '../pages/admin/AdminRoutes';

const admin: User = { ...testUser, id: 1, email: 'admin@example.com', role: 'admin' };

function review(overrides: Partial<ReviewDetail> = {}): ReviewDetail {
  return {
    ...summary({ id: 3, name: '[TEST] Willow Mutual Aid', website: 'https://example.org/willow' }),
    organization: { name: '[TEST] Willow', public_name: null, website: null, phone: null, description: null, description_lang: null },
    location_website: null, email: null, registration_url: null,
    accessibility: { wheelchair_accessible: 'unknown', notes: null, parking: null, transit: null, entrance: null },
    notes: null, notes_lang: null, services: [], eligibility_details: [],
    schedules: { distribution: [], operating_hours: [] }, upcoming_windows: [], exceptions: [], events: [], current_inventory: null,
    sources: [], translations: {}, directions: null,
    review_status: 'needs_review', published: true, merged_into_id: null,
    source_records: [{
      id: 11, source_id: 'synthetic-fixtures', source_name: 'Synthetic fixtures', source_url: 'https://example.org/syn/6', external_id: 'syn-006',
      status: 'linked', raw: { name: 'Willow' }, normalized: { name: '[TEST] Willow Mutual Aid' },
      validation: [{ field: 'schedules', code: 'missing_distribution_schedule', severity: 'warning' }],
      first_seen_at: '2026-10-01T00:00:00Z', last_seen_at: '2026-10-10T00:00:00Z', is_synthetic: true,
    }],
    change_proposals: [{ id: 21, location_id: 3, field: 'phone', current_value: '(555) 010-0006', proposed_value: '(555) 010-9999', source_record_id: 11, status: 'pending', created_at: '2026-10-10T00:00:00Z', decided_at: null }],
    duplicates: [], verification_history: [], audit: [], field_provenance: [],
    ...overrides,
  };
}

describe('admin', () => {
  it('blocks non-admin accounts client-side', async () => {
    mockFetch([], { user: testUser });
    renderApp(<AdminRoutes />, { route: '/admin', path: '/admin/*' });
    expect(await screen.findByRole('heading', { name: 'Administrators only' })).toBeInTheDocument();
  });

  it('overview shows what is waiting, completeness and weekly activity from the API', async () => {
    mockFetch(
      [
        { path: '/api/admin/quality', body: { jurisdiction: null, generated_at: '2026-10-12T00:00:00Z', includes_synthetic: false, metrics: { locations_total: 40, by_review_status: { candidate: 30, needs_review: 2, verified: 8 }, published: 8, stale: 1, pending_conflicts: 3, pending_duplicates: 4, organizations: 12, valid_address_pct: 95.5, with_documented_eligibility_pct: null } } },
        { path: '/api/admin/overview', body: { generated_at: '2026-10-12T00:00:00Z', includes_synthetic: false, pending_claims: 5, open_reports: 0, accounts: 9, weeks: [{ week_start: '2026-10-05', verified: 2, published: 1 }, { week_start: '2026-10-12', verified: 6, published: 0 }] } },
      ],
      { user: admin },
    );
    renderApp(<AdminRoutes />, { route: '/admin/overview', path: '/admin/*' });
    expect(await screen.findByRole('link', { name: '5 Provider access requests' })).toHaveAttribute('href', '/admin/claims');
    expect(screen.getByRole('link', { name: '32 Listings not yet verified' })).toHaveAttribute('href', '/admin/unverified');
    expect(screen.getByRole('link', { name: '7 Conflicts and possible duplicates' })).toHaveAttribute('href', '/admin/conflicts');
    expect(within(screen.getByRole('row', { name: /With a complete address/ })).getByText('95.5%')).toBeInTheDocument();
    // a metric the server could not compute is shown as missing, never as 0%
    expect(within(screen.getByRole('row', { name: /With documented eligibility/ })).getByText('—')).toBeInTheDocument();
    const week = screen.getByRole('row', { name: /Oct 12/ });
    expect(within(week).getByText('6')).toBeInTheDocument();
  });

  it('unverified: each listing is verified on its own, with a method, and then leaves the list', async () => {
    document.cookie = 'nfa_csrf=adm-csrf; path=/';
    const item = (id: number, name: string, pending_changes = 0) => ({ id, name, organization_name: 'Org', address1: '1 St', city: 'X', zip: '22000', jurisdiction_id: null, review_status: 'candidate', verification_label: 'unverified', published: false, operating_status: 'open', has_coordinates: true, last_seen_at: null, last_verified_at: null, sources: ['src-a'], pending_changes, pending_duplicates: 0, is_synthetic: true, phone: '(555) 010-0001', website: 'https://example.org/a' });
    const { calls } = mockFetch(
      [
        { path: '/api/admin/queue', body: { items: [item(3, '[TEST] Willow'), item(4, '[TEST] Maple', 2)], total: 2, page: 1, page_size: 25, counts_by_status: { candidate: 2 } } },
        { method: 'POST', path: '/api/admin/resources/3/actions', body: { id: 3, review_status: 'verified', published: false, operating_status: 'open' } },
      ],
      { user: admin },
    );
    renderApp(<AdminRoutes />, { route: '/admin/unverified', path: '/admin/*' });
    expect(await screen.findByText('2 listings to verify')).toBeInTheDocument();
    expect(calls.some((c) => c.url.searchParams.get('unverified') === 'true')).toBe(true);
    expect(screen.queryByRole('button', { name: /verify all/i })).not.toBeInTheDocument();
    // a listing with unresolved source changes cannot be verified from here
    expect(screen.getByText(/Resolve 2 pending source changes/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Verify' })).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose how you verified');
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);

    await userEvent.selectOptions(screen.getByLabelText('Verification method'), 'phone');
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByText('Verified: [TEST] Willow.')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ action: 'verify', method: 'phone', notes: null });
    expect(screen.queryByRole('link', { name: '[TEST] Willow' })).not.toBeInTheDocument();
    expect(screen.getByText('1 listing to verify')).toBeInTheDocument();
  });

  it('queue shows status counts and records', async () => {
    const { calls } = mockFetch(
      [{ path: '/api/admin/queue', body: { items: [{ id: 3, name: '[TEST] Willow Mutual Aid', organization_name: 'W', address1: '1 St', city: 'X', zip: '22000', jurisdiction_id: null, review_status: 'verified', verification_label: 'verified', published: true, operating_status: 'open', has_coordinates: true, last_seen_at: null, last_verified_at: null, sources: ['synthetic-fixtures'], pending_changes: 1, pending_duplicates: 0, is_synthetic: true }], total: 1, page: 1, page_size: 25, counts_by_status: { verified: 8, candidate: 2 } } }],
      { user: admin },
    );
    renderApp(<AdminRoutes />, { route: '/admin', path: '/admin/*' });
    expect(await screen.findByRole('link', { name: '[TEST] Willow Mutual Aid' })).toHaveAttribute('href', '/admin/resources/3');
    expect(screen.getByRole('button', { name: /Verified 8/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /All 10/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Candidate 2/ }));
    await waitFor(() => expect(calls.some((c) => c.url.searchParams.get('status') === 'candidate')).toBe(true));
  });

  it('review: verify requires a method, actions and decisions send CSRF', async () => {
    document.cookie = 'nfa_csrf=adm-csrf; path=/';
    const { calls } = mockFetch(
      [
        { path: '/api/admin/resources/3', body: review() },
        { method: 'POST', path: '/api/admin/resources/3/actions', body: { id: 3, review_status: 'verified', published: true, operating_status: 'open' } },
        { method: 'POST', path: '/api/admin/changes/21/decision', body: {} },
      ],
      { user: admin },
    );
    renderApp(<AdminRoutes />, { route: '/admin/resources/3', path: '/admin/*' });
    expect(await screen.findByRole('heading', { level: 1, name: '[TEST] Willow Mutual Aid' })).toBeInTheDocument();
    expect(screen.getByText(/missing_distribution_schedule/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open source page' })).toHaveAttribute('href', 'https://example.org/syn/6');
    const proposal = screen.getByText('(555) 010-9999').closest('li')!;
    expect(within(proposal).getByText('(555) 010-0006')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
    expect(screen.getByText(/Choose how you verified/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);

    await userEvent.selectOptions(screen.getByLabelText('Verification method'), 'phone');
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(calls.some((c) => c.url.pathname.endsWith('/actions'))).toBe(true));
    const act = calls.find((c) => c.url.pathname.endsWith('/actions'))!;
    expect(act.body).toEqual({ action: 'verify', method: 'phone', notes: null });
    expect(act.headers['X-CSRF-Token']).toBe('adm-csrf');

    await userEvent.click(within(proposal).getByRole('button', { name: 'Accept change' }));
    await waitFor(() => expect(calls.some((c) => c.url.pathname === '/api/admin/changes/21/decision')).toBe(true));
    expect(calls.find((c) => c.url.pathname === '/api/admin/changes/21/decision')!.body).toEqual({ decision: 'accept', notes: null });
  });

  it('destructive actions ask for confirmation first', async () => {
    const { calls } = mockFetch(
      [
        { path: '/api/admin/resources/3', body: review() },
        { method: 'POST', path: '/api/admin/resources/3/actions', body: { id: 3, review_status: 'rejected', published: false, operating_status: 'open' } },
      ],
      { user: admin },
    );
    renderApp(<AdminRoutes />, { route: '/admin/resources/3', path: '/admin/*' });
    await userEvent.click(await screen.findByRole('button', { name: 'Reject' }));
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Confirm: Reject' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({ action: 'reject' }));
  });
});
