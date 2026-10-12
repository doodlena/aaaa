import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { Features } from '../api/types';
import { ResultsList } from '../components/ResultsList';
import { ResourcePage } from '../pages/ResourcePage';
import { createSelectionStore } from '../state/selection';
import { mockFetch, renderApp, searchResponse, summary } from '../test/utils';
import { detailFixture, visitPlan } from './fixtures';

const lookupOn: Partial<Features> = {
  ai: { search: true, listing_lookup: true, announcement_drafts: true, structure_suggestions: true, translation: false, model: 'test-model' },
};
const lookupOff: Partial<Features> = {
  ai: { search: true, listing_lookup: false, announcement_drafts: true, structure_suggestions: true, translation: false, model: 'test-model' },
};

const ready = {
  status: 'ready',
  generated_at: '2026-10-12T10:00:00Z',
  model: 'test-model',
  notice: 'Found by AI',
  fields: [
    {
      field: 'what_to_bring',
      value: 'Bring your own bags and a photo ID.',
      sources: [{ url: 'https://example.org/pantry', title: 'Maple pantry page', quote: 'Please bring bags and ID.' }],
    },
    { field: 'languages', value: 'English, Spanish', sources: [{ url: 'https://www.example.net/about', title: null, quote: 'Hablamos español' }] },
  ],
};

// Proof of address etc. are "ask" → the AI what-to-bring text is shown right in the checklist area, not as "More details".
const plan = { ...visitPlan, next_windows: [] };

describe('result card date tile', () => {
  it('shows no placeholder box when there is no next distribution', () => {
    const { container } = render(
      <MemoryRouter>
        <ResultsList
          data={searchResponse({ items: [summary({ id: 3, name: 'No Date Pantry', next_distribution: null }), summary({ id: 4, name: 'Dated Pantry' })] })}
          store={createSelectionStore()}
        />
      </MemoryRouter>,
    );
    const noDate = container.querySelector('[data-resource-id="3"]')!;
    expect(noDate.querySelector('.stub')).toBeNull();
    expect(noDate).not.toHaveTextContent(/^\?/);
    expect(noDate.className).toContain('card--nodate');
    // the card still says so in words
    expect((noDate as HTMLElement).querySelector('.next--unknown')).not.toBeNull();
    const dated = container.querySelector('[data-resource-id="4"]')!;
    expect(dated.querySelector('.stub')).not.toBeNull();
    expect(dated.className).not.toContain('card--nodate');
  });
});

describe('AI-found listing info', () => {
  it('merges cached AI facts into "What to bring" with the AI-found badge, source link and notice', async () => {
    mockFetch(
      [
        { path: '/api/resources/1', body: detailFixture({ languages: [] }) },
        { path: '/api/resources/1/visit-plan', body: plan },
        { path: '/api/resources/1/ai-info', body: ready },
      ],
      { features: lookupOn },
    );
    renderApp(<ResourcePage />, { route: '/resource/1', path: '/resource/:id' });
    const planner = await screen.findByTestId('visit-planner');
    const fact = await within(planner).findByText('Bring your own bags and a photo ID.');
    const block = fact.closest('.aifacts') as HTMLElement;
    expect(within(block).getByText('AI-found')).toBeInTheDocument();
    const link = within(block).getByRole('link', { name: /Maple pantry page/ });
    expect(link).toHaveAttribute('href', 'https://example.org/pantry');
    expect(link).toHaveAttribute('title', '“Please bring bags and ID.”');
    expect(within(block).getByText('Found by AI from the linked sources — confirm with the provider.')).toBeInTheDocument();
    // unconfirmed items exist → not presented as "More details"
    expect(within(block).queryByText('More details (AI-found)')).toBeNull();
    // Languages unknown → AI text in the Access section; source label falls back to the domain
    const langFact = screen.getByText('English, Spanish').closest('.aifacts') as HTMLElement;
    expect(within(langFact).getByRole('link', { name: /example\.net/ })).toBeInTheDocument();
    // cached result: no lookup button
    expect(screen.queryByRole('button', { name: /Find missing info with AI/ })).toBeNull();
  });

  it('never replaces confirmed data: AI text next to confirmed info is "More details (AI-found)"', async () => {
    mockFetch(
      [
        { path: '/api/resources/1', body: detailFixture({ languages: ['en'] }) },
        { path: '/api/resources/1/visit-plan', body: plan },
        { path: '/api/resources/1/ai-info', body: ready },
      ],
      { features: lookupOn },
    );
    renderApp(<ResourcePage />, { route: '/resource/1', path: '/resource/:id' });
    const langFact = (await screen.findByText('English, Spanish')).closest('.aifacts') as HTMLElement;
    expect(within(langFact).getByText('More details (AI-found)')).toBeInTheDocument();
    // the confirmed language is still shown
    expect(screen.getByText('English')).toBeInTheDocument();
  });

  it('hides the lookup button when ai.listing_lookup is false', async () => {
    const { calls } = mockFetch(
      [
        { path: '/api/resources/1', body: detailFixture() },
        { path: '/api/resources/1/visit-plan', body: plan },
        { path: '/api/resources/1/ai-info', body: { status: 'none', available: true } },
      ],
      { features: lookupOff },
    );
    renderApp(<ResourcePage />, { route: '/resource/1', path: '/resource/:id' });
    await screen.findByTestId('visit-planner');
    await waitFor(() => expect(calls.some((c) => c.url.pathname === '/api/resources/1/ai-info')).toBe(true));
    await screen.findAllByText(/Proof of address/);
    expect(screen.queryByRole('button', { name: /Find missing info with AI/ })).toBeNull();
  });

  it('POSTs the lookup, shows "Searching the web…", then renders the results in their sections', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const { calls } = mockFetch(
      [
        { path: '/api/resources/1', body: detailFixture() },
        { path: '/api/resources/1/visit-plan', body: plan },
        { path: '/api/resources/1/ai-info', body: { status: 'none', available: true } },
        { method: 'POST', path: '/api/resources/1/ai-info', body: () => ready },
      ],
      { features: lookupOn },
    );
    // hold the POST response until we've seen the loading state
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method || 'GET').toUpperCase() === 'POST') await gate;
      return original(input, init);
    }) as typeof fetch;
    renderApp(<ResourcePage />, { route: '/resource/1', path: '/resource/:id' });
    const btn = await screen.findByRole('button', { name: /Find missing info with AI/ });
    await userEvent.click(btn);
    expect(await screen.findByText('Searching the web…')).toBeInTheDocument();
    expect(btn).toBeDisabled();
    release();
    const done = await screen.findByText(/AI found 2 details/);
    expect(done).toHaveFocus();
    expect(calls.some((c) => c.method === 'POST' && c.url.pathname === '/api/resources/1/ai-info')).toBe(true);
    expect(screen.getByText('Bring your own bags and a photo ID.')).toBeInTheDocument();
    expect(screen.queryByText('Searching the web…')).toBeNull();
    expect(screen.queryByRole('button', { name: /Find missing info with AI/ })).toBeNull();
  });

  it('explains a rate limit (429) without breaking the page', async () => {
    mockFetch(
      [
        { path: '/api/resources/1', body: detailFixture() },
        { path: '/api/resources/1/visit-plan', body: plan },
        { path: '/api/resources/1/ai-info', body: { status: 'none', available: true } },
        { method: 'POST', path: '/api/resources/1/ai-info', status: 429, body: { detail: 'Too many' } },
      ],
      { features: lookupOn },
    );
    renderApp(<ResourcePage />, { route: '/resource/1', path: '/resource/:id' });
    await userEvent.click(await screen.findByRole('button', { name: /Find missing info with AI/ }));
    expect(await screen.findByText(/Too many AI lookups right now/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Find missing info with AI/ })).toBeEnabled();
  });
});
