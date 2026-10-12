import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Layout } from '../components/Layout';
import { mockFetch, renderApp } from '../test/utils';

describe('footer contact email for services', () => {
  it('shows the configured address as a mail link', async () => {
    mockFetch([], { features: { contact_email: 'help@example.org' } });
    renderApp(<Layout />, { route: '/', path: '/' });
    expect(await screen.findByRole('link', { name: 'help@example.org' })).toHaveAttribute('href', 'mailto:help@example.org');
  });

  it('shows nothing when no address is configured', async () => {
    mockFetch([], { features: { contact_email: null } });
    renderApp(<Layout />, { route: '/', path: '/' });
    await screen.findByTestId('footer-crisis');
    expect(screen.queryByText(/Run a food pantry or service/)).toBeNull();
  });
});
