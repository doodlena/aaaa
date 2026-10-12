import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { mockFetch, renderApp, searchResponse, summary } from '../test/utils';

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
