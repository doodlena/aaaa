import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { FavoritesPage } from '../pages/FavoritesPage';
import { mockFetch, renderApp, summary, testUser } from '../test/utils';

describe('FavoritesPage', () => {
  it('lists saved places, hides unpublished ones, and removes with CSRF', async () => {
    document.cookie = 'nfa_csrf=csrf-abc; path=/';
    let items = [
      { id: 1, available: true, resource: summary({ id: 1, name: '[TEST] Maple Community Pantry' }) },
      { id: 4, available: false, resource: null },
    ];
    const { calls } = mockFetch(
      [
        { path: '/api/me/favorites', body: () => ({ items }) },
        {
          method: 'DELETE',
          path: /^\/api\/me\/favorites\/1$/,
          status: 204,
          body: () => {
            items = items.filter((i) => i.id !== 1);
            return null;
          },
        },
      ],
      { user: testUser },
    );
    renderApp(<FavoritesPage />, { route: '/favorites', path: '/favorites' });
    expect(await screen.findByRole('link', { name: '[TEST] Maple Community Pantry' })).toBeInTheDocument();
    expect(screen.getByText('No longer listed')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove [TEST] Maple Community Pantry' }));
    await waitFor(() => expect(screen.queryByRole('link', { name: '[TEST] Maple Community Pantry' })).toBeNull());
    const del = calls.find((c) => c.method === 'DELETE')!;
    expect(del.headers['X-CSRF-Token']).toBe('csrf-abc');
    expect(screen.getByText('Removed from your list.')).toBeInTheDocument();
  });

  it('shows an empty state', async () => {
    mockFetch([{ path: '/api/me/favorites', body: { items: [] } }], { user: testUser });
    renderApp(<FavoritesPage />, { route: '/favorites', path: '/favorites' });
    expect(await screen.findByText('You have not saved any places yet')).toBeInTheDocument();
  });

  it('sends guests to sign in', async () => {
    mockFetch([]);
    renderApp(<FavoritesPage />, { route: '/favorites', path: '/favorites' });
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/login?next=/favorites'));
  });
});
