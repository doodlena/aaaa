import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { User } from '../api/types';
import { AISearch } from '../components/AISearch';
import { ReportDialog } from '../components/ReportDialog';
import { VisitPlanner } from '../components/VisitPlanner';
import en from '../i18n/locales/en.json';
import es from '../i18n/locales/es.json';
import { activeFilterCount, buildSearchQuery, DEFAULT_FILTERS, filtersFromURL, filtersToURL } from '../lib/filters';
import { aiOn, mockFetch, renderApp, testUser } from '../test/utils';
import { detailFixture, visitPlan } from './fixtures';

vi.mock('../components/MiniMap', () => ({ default: () => <div data-testid="minimap" /> }));
import AdminRoutes from '../pages/admin/AdminRoutes';
import PantryRoutes from '../pages/pantry/PantryRoutes';

const parse = (q: string) => Object.fromEntries(new URLSearchParams(q));

describe('live filters', () => {
  it('build live_open / live_food_group and round-trip through the URL', () => {
    const f = { ...DEFAULT_FILTERS, lat: 1, lon: 2, live_open: true, live_food_groups: ['produce', 'dairy'] };
    expect(parse(buildSearchQuery(f))).toMatchObject({ live_open: 'true', live_food_group: 'produce,dairy' });
    const back = filtersFromURL(filtersToURL(f));
    expect(back.live_open).toBe(true);
    expect(back.live_food_groups).toEqual(['produce', 'dairy']);
    expect(activeFilterCount(f)).toBe(3);
    expect(filtersFromURL(new URLSearchParams('live_food_group=produce,bogus')).live_food_groups).toEqual(['produce']);
    expect(parse(buildSearchQuery(DEFAULT_FILTERS))).not.toHaveProperty('live_open');
  });
});

describe('report a problem', () => {
  it('sends an anonymous report and confirms', async () => {
    const { calls } = mockFetch([{ method: 'POST', path: '/api/resources/1/reports', status: 201, body: { id: 5, status: 'open' } }]);
    renderApp(<ReportDialog id={1} name="[TEST] Maple" onClose={() => {}} />);
    expect(screen.getByRole('dialog', { name: 'Report a problem' })).toBeInTheDocument();
    expect(screen.getByText(/No name, account or location is stored/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Send report' }));
    expect(screen.getByText('Choose what happened.')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    await userEvent.click(screen.getByRole('radio', { name: 'Something else' }));
    await userEvent.type(screen.getByLabelText(/Tell us more/), 'Door sign says new hours');
    await userEvent.click(screen.getByRole('button', { name: 'Send report' }));
    expect(await screen.findByText('Thank you. Your report was sent.')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ kind: 'other', note: 'Door sign says new hours' });
  });

  it('explains rate limiting (429) kindly', async () => {
    mockFetch([{ method: 'POST', path: '/api/resources/1/reports', status: 429, body: { detail: 'slow down' } }]);
    renderApp(<ReportDialog id={1} name="x" onClose={() => {}} />);
    await userEvent.click(screen.getByRole('radio', { name: 'It was closed when I went' }));
    await userEvent.click(screen.getByRole('button', { name: 'Send report' }));
    expect(await screen.findByText(/sent several reports recently/)).toBeInTheDocument();
    expect(screen.queryByText('Thank you. Your report was sent.')).toBeNull();
  });
});

describe('visit planner', () => {
  it('renders bring / not needed / ask, never showing "ask" as not needed, plus calendar link', async () => {
    mockFetch([{ path: '/api/resources/1/visit-plan', body: visitPlan }]);
    renderApp(<VisitPlanner r={detailFixture()} />);
    const list = await screen.findByRole('list', { name: 'What to bring' });
    const row = (key: string) => list.querySelector(`[data-key="${key}"]`) as HTMLElement;
    expect(row('photo_id')).toHaveTextContent('Not needed (confirmed)');
    expect(row('income_documentation')).toHaveTextContent('Proof of incomeBring');
    expect(row('appointment')).toHaveTextContent('Required — do this first');
    for (const key of ['proof_of_address', 'benefit_documentation', 'referral', 'registration']) {
      expect(row(key)).toHaveTextContent('Ask the pantry — not confirmed');
      expect(row(key)).not.toHaveTextContent('Not needed');
    }
    expect(screen.getByText('Suggestion: bring bags or a box.')).toBeInTheDocument();
    expect(screen.getByTestId('calendar-link')).toHaveAttribute('href', '/api/resources/1/calendar.ics');
    expect(screen.getByRole('button', { name: 'Print visit card' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument();
  });

  it('says so when no times are confirmed', async () => {
    mockFetch([{ path: '/api/resources/1/visit-plan', body: { ...visitPlan, next_windows: [] } }]);
    renderApp(<VisitPlanner r={detailFixture()} />);
    expect((await screen.findAllByText(/No upcoming times are confirmed/))[0]).toBeVisible();
  });
});

const staff: User = { ...testUser, id: 8, email: 'pantry@example.com' };
const me = {
  items: [
    { membership_id: 1, status: 'approved', role_title: 'Coordinator', location_id: 1, name: '[TEST] Maple', address1: '1 St', city: 'Arlington', live: null, open_reports: 0, pending_changes: 0 },
    { membership_id: 2, status: 'pending', role_title: 'Volunteer', location_id: 4, name: '[TEST] Cedar', address1: null, city: null },
  ],
  food_types: ['fresh_vegetables', 'eggs', 'dairy', 'bread'],
};

describe('pantry portal', () => {
  it('lists approved pantries and pending requests', async () => {
    mockFetch([{ path: '/api/provider/me', body: me }], { user: staff });
    renderApp(<PantryRoutes />, { route: '/pantry', path: '/pantry/*' });
    expect(await screen.findByRole('link', { name: '[TEST] Maple' })).toHaveAttribute('href', '/pantry/1');
    expect(screen.getByText('Waiting for review')).toBeInTheDocument();
  });

  it('posts "Open" with items, levels and message', async () => {
    document.cookie = 'nfa_csrf=pantry-csrf; path=/';
    const { calls } = mockFetch(
      [
        { path: '/api/provider/me', body: me },
        { path: '/api/provider/locations/1/shelf/history', body: { items: [] } },
        { method: 'POST', path: '/api/provider/locations/1/shelf', status: 201, body: { status: 'open', message: null, items: [], posted_at: new Date().toISOString(), expires_at: new Date().toISOString(), source: 'pantry', ai_assisted: false } },
      ],
      { user: staff },
    );
    renderApp(<PantryRoutes />, { route: '/pantry/1', path: '/pantry/*' });
    await screen.findByRole('heading', { level: 1, name: '[TEST] Maple' });
    await userEvent.click(screen.getByRole('button', { name: 'Post to families' }));
    expect(screen.getByText(/Choose Open, Limited/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('button', { name: 'Open' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Fresh vegetables' }));
    await userEvent.selectOptions(screen.getByLabelText('How much Fresh vegetables'), 'plenty');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Eggs' }));
    await userEvent.type(screen.getByLabelText(/Short message for families/), 'Greens are in');
    // the preview shows what families will see
    expect(screen.getByText('Preview — what families will see').parentElement).toHaveTextContent('Posted by the pantry');
    await userEvent.click(screen.getByRole('button', { name: 'Post to families' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.headers['X-CSRF-Token']).toBe('pantry-csrf');
    expect(post.body).toMatchObject({
      status: 'open',
      message: 'Greens are in',
      items: [
        { food_type: 'fresh_vegetables', level: 'plenty' },
        { food_type: 'eggs', level: 'some' },
      ],
      ai_assisted: false,
    });
    expect((post.body as { expires_at: string }).expires_at).toMatch(/T/);
    expect(await screen.findByText('Posted. Families can see it now.')).toBeInTheDocument();
  });

  it('AI announcement draft prefills the form, flags it, and posts nothing until clicked', async () => {
    const draft = {
      kind: 'shelf_update',
      status: 'limited',
      message: 'Low on protein, lots of bread',
      items: [{ food_type: 'bread', level: 'plenty' }],
      event: null,
      closure: null,
      things_to_check: ['Is "today" Monday the 12th?'],
    };
    const { calls } = mockFetch(
      [
        { path: '/api/provider/me', body: me },
        { path: '/api/provider/locations/1/shelf/history', body: { items: [] } },
        { method: 'POST', path: '/api/provider/locations/1/ai/announcement-draft', body: { draft, notice: 'Draft only' } },
        { method: 'POST', path: '/api/provider/locations/1/shelf', status: 201, body: { ...draft, posted_at: new Date().toISOString(), expires_at: new Date().toISOString(), source: 'pantry', ai_assisted: true } },
      ],
      { user: staff, features: aiOn },
    );
    renderApp(<PantryRoutes />, { route: '/pantry/1', path: '/pantry/*' });
    await userEvent.type(await screen.findByLabelText('Announcement text'), 'We are low on protein today but have lots of bread!');
    await userEvent.click(screen.getByRole('button', { name: 'Draft the form' }));
    expect(await screen.findByText('Drafted by AI — check every field before posting.')).toBeInTheDocument();
    expect(screen.getByText('Is "today" Monday the 12th?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Limited' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('checkbox', { name: 'Bread' })).toBeChecked();
    expect(screen.getByLabelText(/Short message for families/)).toHaveValue('Low on protein, lots of bread');
    // nothing was posted by the draft itself
    expect(calls.filter((c) => c.url.pathname.endsWith('/shelf') && c.method === 'POST')).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Post to families' }));
    await waitFor(() => expect(calls.some((c) => c.url.pathname.endsWith('/shelf') && c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.url.pathname.endsWith('/shelf') && c.method === 'POST')!.body).toMatchObject({ status: 'limited', ai_assisted: true });
  });

  it('hides the AI paste box when AI drafts are disabled', async () => {
    mockFetch([{ path: '/api/provider/me', body: me }, { path: '/api/provider/locations/1/shelf/history', body: { items: [] } }], { user: staff });
    renderApp(<PantryRoutes />, { route: '/pantry/1', path: '/pantry/*' });
    await screen.findByRole('heading', { level: 1, name: '[TEST] Maple' });
    expect(screen.queryByLabelText('Announcement text')).toBeNull();
  });

  it('sends signed-out visitors to sign in', async () => {
    mockFetch([]);
    renderApp(<PantryRoutes />, { route: '/pantry', path: '/pantry/*' });
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/login?next=%2Fpantry'));
  });
});

describe('AI search', () => {
  it('is hidden entirely when disabled', async () => {
    mockFetch([]);
    renderApp(<AISearch />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('ai-search')).toBeNull();
  });

  it('applies the suggested filters and place to the explorer URL', async () => {
    const { calls } = mockFetch(
      [
        {
          method: 'POST',
          path: '/api/ai/search',
          body: {
            filters: { food_group: ['produce', 'nonsense'], service_group: [], eligibility: ['no_id_required'], date: '2026-10-17', wheelchair: true },
            place: { label: 'ZIP 22204', lat: 38.86, lon: -77.099, source: 'x', precision: 'zip' },
            explanation: 'Fresh produce near 22204 on Saturday, no ID.',
            notice: 'Filters were suggested by an AI assistant.',
          },
        },
      ],
      { features: aiOn },
    );
    renderApp(<AISearch />);
    expect(await screen.findByText(/Only the words you type are sent to an AI service/)).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: /Describe what you need/ }), 'veggies near 22204 saturday no id');
    await userEvent.click(screen.getByRole('button', { name: 'Find' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/find?'));
    const url = new URLSearchParams(screen.getByTestId('location').textContent!.split('?')[1]);
    expect(url.get('food_group')).toBe('produce');
    expect(url.get('eligibility')).toBe('no_id_required');
    expect(url.get('schedule')).toBe('date');
    expect(url.get('date')).toBe('2026-10-17');
    expect(url.get('wheelchair')).toBe('true');
    expect(url.get('lat')).toBe('38.86');
    expect(calls.find((c) => c.url.pathname === '/api/ai/search')!.body).toEqual({ q: 'veggies near 22204 saturday no id', lang: 'en' });
  });
});

describe('admin: pantry access & reports', () => {
  const admin: User = { ...testUser, id: 1, email: 'admin@example.com', role: 'admin' };
  it('claims queue shows the listing phone with guidance and approves', async () => {
    const { calls } = mockFetch(
      [
        {
          path: '/api/admin/claims',
          body: { items: [{ id: 4, status: 'pending', role_title: 'Coordinator', note: 'I run Tuesdays', user_email: 'pantry@example.com', location_id: 1, location_name: '[TEST] Maple', location_phone: '(555) 010-0001', created_at: '2026-10-12T10:00:00Z' }] },
        },
        { method: 'POST', path: '/api/admin/claims/4/decision', body: { id: 4, status: 'approved' } },
      ],
      { user: admin },
    );
    renderApp(<AdminRoutes />, { route: '/admin/claims', path: '/admin/*' });
    expect(await screen.findByText('pantry@example.com')).toBeInTheDocument();
    expect(screen.getByText(/Call the pantry to confirm this person before approving/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '(555) 010-0001' })).toHaveAttribute('href', 'tel:5550100001');
    await userEvent.click(screen.getByRole('button', { name: 'Approve — pantry@example.com' }));
    await waitFor(() => expect(calls.some((c) => c.url.pathname === '/api/admin/claims/4/decision')).toBe(true));
    expect(calls.find((c) => c.url.pathname === '/api/admin/claims/4/decision')!.body).toEqual({ decision: 'approve', notes: null });
    expect(await screen.findByText('Saved: Approved')).toBeInTheDocument();
  });

  it('reports queue resolves', async () => {
    const { calls } = mockFetch(
      [
        { path: '/api/admin/reports', body: { items: [{ id: 9, location_id: 3, location_name: '[TEST] Oak Street', kind: 'was_closed', note: null, status: 'open', created_at: null, provider_response: null }] } },
        { method: 'POST', path: '/api/admin/reports/9/decision', body: { id: 9, status: 'resolved' } },
      ],
      { user: admin },
    );
    renderApp(<AdminRoutes />, { route: '/admin/reports', path: '/admin/*' });
    expect(await screen.findByText('It was closed when I went')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ decision: 'resolve', notes: null }));
  });
});

describe('i18n catalogs', () => {
  const flat = (o: Record<string, unknown>, p = ''): string[] =>
    Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? flat(v as Record<string, unknown>, `${p}${k}.`) : [`${p}${k}`]));
  it('en and es have identical keys, including every live/needs/crisis namespace', () => {
    expect(flat(es).sort()).toEqual(flat(en).sort());
    for (const ns of ['live', 'today', 'feed', 'reports', 'visit', 'ai', 'portal', 'offline', 'time', 'needs', 'crisis']) expect(en).toHaveProperty(ns);
  });
  it('no old brand strings remain and no value is empty', () => {
    const values = (o: Record<string, unknown>): string[] => Object.values(o).flatMap((v) => (v && typeof v === 'object' ? values(v as Record<string, unknown>) : [String(v)]));
    for (const cat of [en, es]) {
      for (const v of values(cat)) {
        expect(v.trim()).not.toBe('');
        expect(v).not.toMatch(/Food Access|FoodFinder|Acceso a Alimentos|Open Shelf/);
      }
    }
  });
});
