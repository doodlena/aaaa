import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Features } from '../api/types';
import { AccountPage } from '../pages/AccountPage';
import { LoginPage, OAuthCallbackPage } from '../pages/AuthPages';
import { mockFetch, renderApp, testUser } from '../test/utils';

const oauthOn: Partial<Features> = { oauth: { enabled: true, provider: 'Example ID' } };

/** jsdom cannot navigate; capture where the page would send the browser. */
function stubLocation() {
  const assign = vi.fn();
  vi.stubGlobal('location', { ...window.location, assign });
  return assign;
}

describe('OAuth sign-in', () => {
  it('is hidden unless the server has a provider configured', async () => {
    const { calls } = mockFetch([]);
    renderApp(<LoginPage />, { route: '/login', path: '/login' });
    await waitFor(() => expect(calls.some((c) => c.url.pathname === '/api/meta/features')).toBe(true));
    expect(screen.queryByRole('button', { name: /Continue with/ })).not.toBeInTheDocument();
  });

  it('sends the browser to the provider and remembers where to return', async () => {
    const assign = stubLocation();
    const { calls } = mockFetch([{ method: 'POST', path: '/api/auth/oauth/start', body: { url: 'https://id.example.org/authorize?state=s1' } }], {
      features: oauthOn,
    });
    renderApp(<LoginPage />, { route: '/login?next=/favorites', path: '/login' });
    await userEvent.click(await screen.findByRole('button', { name: 'Continue with Example ID' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://id.example.org/authorize?state=s1'));
    expect(calls.find((c) => c.url.pathname === '/api/auth/oauth/start')!.body).toEqual({ link: false });
    expect(JSON.parse(sessionStorage.getItem('nfa_oauth_flow')!)).toEqual({ next: '/favorites', link: false });
  });

  it('Google gets the standard button with the G logo, placed above the email form', async () => {
    mockFetch([], { features: { oauth: { enabled: true, provider: 'Google' } } });
    renderApp(<LoginPage />, { route: '/login', path: '/login' });
    const btn = await screen.findByRole('button', { name: 'Continue with Google' });
    expect(btn).toHaveClass('oauth__google');
    expect(btn.querySelector('svg.oauth__logo')).not.toBeNull();
    const email = screen.getByLabelText('Email');
    expect(btn.compareDocumentPosition(email) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('finishes sign-in on the callback page, exchanging the code exactly once', async () => {
    sessionStorage.setItem('nfa_oauth_flow', JSON.stringify({ next: '/favorites', link: false }));
    const { calls } = mockFetch([{ method: 'POST', path: '/api/auth/oauth/callback', body: { ...testUser, has_password: false, oauth_linked: true } }]);
    renderApp(<OAuthCallbackPage />, { route: '/auth/callback?code=c1&state=s1', path: '/auth/callback' });
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/favorites'));
    const posts = calls.filter((c) => c.url.pathname === '/api/auth/oauth/callback');
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toEqual({ code: 'c1', state: 's1', preferred_language: 'en' });
    expect(sessionStorage.getItem('nfa_oauth_flow')).toBeNull();
  });

  it('ignores an unsafe return address', async () => {
    sessionStorage.setItem('nfa_oauth_flow', JSON.stringify({ next: '//evil.example', link: false }));
    mockFetch([{ method: 'POST', path: '/api/auth/oauth/callback', body: testUser }]);
    renderApp(<OAuthCallbackPage />, { route: '/auth/callback?code=c1&state=s1', path: '/auth/callback' });
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/));
  });

  it('explains when the email already belongs to a password account', async () => {
    mockFetch([{ method: 'POST', path: '/api/auth/oauth/callback', status: 409, body: { detail: 'exists' } }]);
    renderApp(<OAuthCallbackPage />, { route: '/auth/callback?code=c1&state=s1', path: '/auth/callback' });
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign in with your password, then connect the provider from your account page.');
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/login');
  });

  it('shows a cancel message without calling the API when the person declines at the provider', async () => {
    const { calls } = mockFetch([]);
    renderApp(<OAuthCallbackPage />, { route: '/auth/callback?error=access_denied', path: '/auth/callback' });
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign-in was cancelled.');
    expect(calls.some((c) => c.url.pathname === '/api/auth/oauth/callback')).toBe(false);
  });

  it('account page: a password account can connect the provider', async () => {
    const assign = stubLocation();
    const { calls } = mockFetch([{ method: 'POST', path: '/api/auth/oauth/start', body: { url: 'https://id.example.org/authorize?state=s2' } }], {
      user: testUser,
      features: oauthOn,
    });
    renderApp(<AccountPage />, { route: '/account', path: '/account' });
    await userEvent.click(await screen.findByRole('button', { name: 'Connect Example ID' }));
    await waitFor(() => expect(assign).toHaveBeenCalled());
    expect(calls.find((c) => c.url.pathname === '/api/auth/oauth/start')!.body).toEqual({ link: true });
    expect(JSON.parse(sessionStorage.getItem('nfa_oauth_flow')!)).toEqual({ next: '/account', link: true });
  });

  it('account page: an OAuth-only account deletes without a password field', async () => {
    document.cookie = 'nfa_csrf=tok123; path=/';
    const { calls } = mockFetch([{ method: 'DELETE', path: '/api/me', status: 204 }], {
      user: { ...testUser, has_password: false, oauth_linked: true },
      features: oauthOn,
    });
    renderApp(<AccountPage />, { route: '/account', path: '/account' });
    expect(await screen.findByText('Example ID is connected. You can sign in with it.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Enter your password to confirm')).not.toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('I understand this cannot be undone'));
    await userEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
  });
});
