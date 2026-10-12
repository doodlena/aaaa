import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { LoginPage, RegisterPage, safeNext } from '../pages/AuthPages';
import { mockFetch, renderApp, testUser } from '../test/utils';

describe('auth forms', () => {
  it('signs in and follows a safe ?next redirect', async () => {
    const { calls } = mockFetch([{ method: 'POST', path: '/api/auth/login', body: testUser }]);
    renderApp(<LoginPage />, { route: '/login?next=/favorites', path: '/login' });
    await userEvent.type(screen.getByLabelText('Email'), 'person@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'correct-horse-1');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/favorites'));
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ email: 'person@example.com', password: 'correct-horse-1' });
  });

  it('shows a clear error for wrong credentials', async () => {
    mockFetch([{ method: 'POST', path: '/api/auth/login', status: 401, body: { detail: 'Email or password is incorrect' } }]);
    renderApp(<LoginPage />, { route: '/login' });
    await userEvent.type(screen.getByLabelText('Email'), 'person@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong-password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The email or password is incorrect.');
    expect(screen.getByTestId('location')).toHaveTextContent('/login');
  });

  it('validates registration before calling the API', async () => {
    const { calls } = mockFetch([]);
    renderApp(<RegisterPage />, { route: '/register' });
    await userEvent.type(screen.getByLabelText('Email'), 'new@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'short');
    await userEvent.type(screen.getByLabelText('Type your password again'), 'short');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('at least 10 characters');
    expect(calls.some((c) => c.url.pathname === '/api/auth/register')).toBe(false);
  });

  it('registers with the current UI language and reports a taken email', async () => {
    const { calls } = mockFetch([{ method: 'POST', path: '/api/auth/register', status: 409, body: { detail: 'exists' } }]);
    renderApp(<RegisterPage />, { route: '/register' });
    await userEvent.type(screen.getByLabelText('Email'), 'dup@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'long-enough-pw');
    await userEvent.type(screen.getByLabelText('Type your password again'), 'long-enough-pw');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists');
    expect(calls.find((c) => c.url.pathname === '/api/auth/register')!.body).toEqual({
      email: 'dup@example.com',
      password: 'long-enough-pw',
      preferred_language: 'en',
    });
  });

  it('rejects open redirects', () => {
    expect(safeNext('//evil.example')).toBe('/');
    expect(safeNext('https://evil.example')).toBe('/');
    expect(safeNext('/account')).toBe('/account');
  });
});
