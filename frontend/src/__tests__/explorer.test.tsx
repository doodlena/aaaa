import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { mockFetch, renderApp, searchResponse, summary } from '../test/utils';
import { testUser } from '../test/utils';

vi.mock('../components/MapView', () => ({ default: () => <div data-testid="map-stub" /> }));
import ExplorerPage from '../pages/ExplorerPage';

describe('ExplorerPage', () => {
  it('shows an error with retry when search fails, then recovers', async () => {
    let fail = true;
    mockFetch([{ path: '/api/resources/search', body: searchResponse() }]);
    // the search endpoint fails with a 500 until `fail` is cleared
    const original = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const wrapped = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/resources/search') && fail) {
        return new Response(JSON.stringify({ detail: 'db down' }), { status: 500 });
      }
      return original(input, init);
    });
    vi.stubGlobal('fetch', wrapped);
    renderApp(<ExplorerPage />, { route: '/find?lat=38.86&lon=-77.099', path: '/find' });
    expect(await screen.findByRole('alert')).toHaveTextContent('We could not load results');
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('link', { name: '[TEST] Maple Community Pantry' })).toBeInTheDocument();
  });

  it('search options can be folded away to give the list and map more room, and the choice is remembered', async () => {
    mockFetch([{ path: '/api/resources/search', body: searchResponse({ items: [summary()] }) }]);
    const first = renderApp(<ExplorerPage />, { route: '/find?lat=38.86&lon=-77.099&label=ZIP%2022204', path: '/find' });
    await screen.findByRole('link', { name: '[TEST] Maple Community Pantry' });
    const fold = screen.getByRole('button', { name: 'Hide search options' });
    expect(fold).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Your address or ZIP code')).toBeVisible();
    expect(screen.getByLabelText('Distance')).toBeInTheDocument();

    await userEvent.click(fold);
    const unfold = screen.getByRole('button', { name: 'Show search options' });
    expect(unfold).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByLabelText('Your address or ZIP code')).not.toBeVisible();
    expect(screen.queryByLabelText('Distance')).toBeNull();
    // the place being searched and the results stay on screen
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Help near ZIP 22204');
    expect(screen.getByRole('link', { name: '[TEST] Maple Community Pantry' })).toBeInTheDocument();

    first.unmount(); // coming back to the page later keeps it folded
    renderApp(<ExplorerPage />, { route: '/find?lat=38.86&lon=-77.099', path: '/find' });
    expect(await screen.findByRole('button', { name: 'Show search options' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show search options' }));
    expect(screen.getByLabelText('Your address or ZIP code')).toBeVisible();
  });

  it('Distance offers "No limit", which searches without a radius', async () => {
    const { calls } = mockFetch([{ path: '/api/resources/search', body: searchResponse({ items: [summary()] }) }]);
    renderApp(<ExplorerPage />, { route: '/find?lat=38.86&lon=-77.099', path: '/find' });
    await screen.findByRole('link', { name: '[TEST] Maple Community Pantry' });
    await userEvent.selectOptions(screen.getByLabelText('Distance'), 'No limit');
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('radius_km=any'));
    await waitFor(() =>
      expect(calls.some((c) => c.url.pathname === '/api/resources/search' && c.url.searchParams.get('any_distance') === 'true' && !c.url.searchParams.get('radius_km'))).toBe(true),
    );
    expect(screen.getByLabelText('Distance')).toHaveDisplayValue('No limit');
  });

  it('applying a filter updates the URL and the API query', async () => {
    const { calls } = mockFetch([{ path: '/api/resources/search', body: searchResponse({ items: [summary()] }) }]);
    renderApp(<ExplorerPage />, { route: '/find?lat=38.86&lon=-77.099', path: '/find' });
    await screen.findByRole('link', { name: '[TEST] Maple Community Pantry' });
    await userEvent.click(screen.getByRole('checkbox', { name: 'No ID required (confirmed)' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('eligibility=no_id_required'));
    await waitFor(() =>
      expect(calls.some((c) => c.url.pathname === '/api/resources/search' && c.url.searchParams.get('eligibility') === 'no_id_required')).toBe(true),
    );
  });

  it('announces network failures in plain language', async () => {
    mockFetch([]);
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/resources/search')) throw new TypeError('Failed to fetch');
      return new Response(JSON.stringify({ user: null }), { status: 200 });
    }));
    renderApp(<ExplorerPage />, { route: '/find?lat=38.86&lon=-77.099', path: '/find' });
    expect(await screen.findByRole('alert')).toHaveTextContent('We could not connect');
  });
});

describe('saved preferences on Find help', () => {
  it('applies a signed-in person\'s saved filters, says so, and can ignore them', async () => {
    const user = { ...testUser, preferences: { eligibility: ['no_id_required'], wheelchair: true } };
    const { calls } = mockFetch([{ path: '/api/resources/search', body: searchResponse({ items: [summary()] }) }], { user });
    renderApp(<ExplorerPage />, { route: '/find?lat=38.86&lon=-77.099', path: '/find' });
    expect(await screen.findByText(/Using your saved preferences/)).toBeInTheDocument();
    await waitFor(() => expect(calls.some((c) => c.url.pathname === '/api/resources/search' && c.url.searchParams.get('wheelchair') === 'true')).toBe(true));
    await userEvent.click(screen.getByRole('button', { name: 'Ignore for this search' }));
    await waitFor(() => expect(screen.queryByText(/Using your saved preferences/)).toBeNull());
    const last = calls.filter((c) => c.url.pathname === '/api/resources/search').at(-1)!;
    expect(last.url.searchParams.get('wheelchair')).toBeNull();
  });
});

