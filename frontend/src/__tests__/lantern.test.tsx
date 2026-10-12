import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AISettings, User } from '../api/types';
import en from '../i18n/locales/en.json';
import es from '../i18n/locales/es.json';
import {
  DEFAULT_FILTERS,
  FOOD_GROUPS,
  SERVICE_GROUPS,
  SERVICE_TYPES,
} from '../lib/filters';
import { NEEDS, needURL } from '../lib/needs';
import { HomePage } from '../pages/HomePage';
import { mockFetch, renderApp, searchResponse, summary } from '../test/utils';
import { detailFixture, visitPlan } from './fixtures';

vi.mock('../components/MapView', () => ({ default: () => <div data-testid="map-stub" /> }));
vi.mock('../components/MiniMap', () => ({ default: () => <div data-testid="minimap" /> }));
import ExplorerPage from '../pages/ExplorerPage';
import { ResourcePage } from '../pages/ResourcePage';
import AdminRoutes from '../pages/admin/AdminRoutes';

const admin: User = { id: 1, email: 'admin@example.com', role: 'admin', preferred_language: 'en', preferences: {}, has_password: true, oauth_linked: false };
const searchCalls = (calls: { url: URL }[]) => calls.filter((c) => c.url.pathname === '/api/resources/search').map((c) => c.url.searchParams);

describe('needs chooser', () => {
  it('home tiles link to /find with exactly one need filter', async () => {
    mockFetch([{ path: '/api/resources/search', body: searchResponse({ items: [] }) }]);
    renderApp(<HomePage />);
    const nav = screen.getByRole('navigation', { name: 'What do you need?' });
    const links = within(nav).getAllByRole('link');
    expect(links).toHaveLength(15);
    const href = (name: RegExp) => new URL(within(nav).getByRole('link', { name }).getAttribute('href')!, 'http://x');
    expect(href(/^Mental health and crisis/).searchParams.get('service_group')).toBe('mental_health');
    expect(href(/^Food/).searchParams.get('food_group')).toBe('groceries');
    expect(href(/^Food/).searchParams.get('service_group')).toBeNull();
    expect(href(/^Benefits help/).searchParams.get('service_group')).toBe('benefits');
    expect(href(/^Legal and immigration/).searchParams.get('service_group')).toBe('legal');
    expect(href(/^Hot meals/).searchParams.get('service_group')).toBe('community_meal');
    const browse = new URL(screen.getByRole('link', { name: 'Explore all available resources' }).getAttribute('href')!, 'http://x');
    expect(browse.pathname).toBe('/find');
    expect(browse.search).toBe('');
  });

  it('every need maps to a known group and keeps the searched place', () => {
    for (const n of NEEDS) {
      if (n.service_group) expect(SERVICE_GROUPS).toContain(n.service_group);
      if (n.food_group) expect(FOOD_GROUPS).toContain(n.food_group);
    }
    const base = { ...DEFAULT_FILTERS, lat: 38.86, lon: -77.1, label: 'ZIP 22204', food_groups: ['produce'], live_open: true };
    const url = new URL(needURL(NEEDS.find((n) => n.id === 'legal')!, base), 'http://x');
    expect(url.searchParams.get('lat')).toBe('38.86');
    expect(url.searchParams.get('service_group')).toBe('legal');
    expect(url.searchParams.get('food_group')).toBeNull(); // non-food need drops food filters
    expect(url.searchParams.get('live_open')).toBeNull();
  });

  it('explorer chips are multi-select: needs add up and the search asks for places offering any of them', async () => {
    const { calls } = mockFetch([
      { path: '/api/resources/search', body: searchResponse() },
    ]);
    renderApp(<ExplorerPage />, { route: '/find?lat=38.86&lon=-77.099&food_group=groceries', path: '/find' });
    await screen.findByRole('link', { name: '[TEST] Maple Community Pantry' });
    const group = screen.getByRole('group', { name: /What do you need\?/ });
    const chip = (name: RegExp) => within(group).getByRole('button', { name });
    expect(chip(/^Food/)).toHaveAttribute('aria-pressed', 'true');
    expect(searchCalls(calls).every((p) => !p.get('need_match'))).toBe(true); // one need: nothing to combine

    await userEvent.click(chip(/Housing and utilities/));
    await userEvent.click(chip(/Clothing/));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('service_group=housing%2Cclothing'));
    expect(screen.getByTestId('location')).toHaveTextContent('food_group=groceries');
    for (const name of [/^Food/, /Housing and utilities/, /Clothing/]) expect(chip(name)).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() =>
      expect(searchCalls(calls).some((p) => p.get('service_group') === 'housing,clothing' && p.get('food_group') === 'groceries' && p.get('need_match') === 'any')).toBe(true),
    );
    expect(screen.getByRole('group', { name: 'Type of food' })).toBeInTheDocument(); // a food need is still selected

    await userEvent.click(chip(/Housing and utilities/)); // pressing again removes only that need
    await waitFor(() => expect(screen.getByTestId('location')).not.toHaveTextContent('housing'));
    expect(chip(/Clothing/)).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(within(group).getByRole('button', { name: 'Any kind of help' }));
    await waitFor(() => expect(screen.getByTestId('location')).not.toHaveTextContent('service_group'));
    expect(screen.getByTestId('location')).not.toHaveTextContent('food_group');
  });

  it('hides food filters once no food need is selected', async () => {
    const { calls } = mockFetch([
      { path: '/api/resources/search', body: searchResponse() },
    ]);
    renderApp(<ExplorerPage />, { route: '/find?lat=38.86&lon=-77.099&food_group=groceries', path: '/find' });
    await screen.findByRole('link', { name: '[TEST] Maple Community Pantry' });
    const group = screen.getByRole('group', { name: /What do you need\?/ });
    expect(within(group).getByRole('button', { name: /^Food/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('group', { name: 'Type of food' })).toBeInTheDocument();
    await userEvent.click(within(group).getByRole('button', { name: /Housing and utilities/ }));
    await userEvent.click(within(group).getByRole('button', { name: /^Food/ }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('service_group=housing'));
    expect(screen.getByTestId('location')).not.toHaveTextContent('food_group');
    await waitFor(() => expect(searchCalls(calls).some((p) => p.get('service_group') === 'housing' && !p.get('food_group'))).toBe(true));
    expect(screen.queryByRole('group', { name: 'Type of food' })).toBeNull();
    expect(screen.getByText(/Food filters are hidden/)).toBeInTheDocument();
  });
});

describe('988 crisis callout (moved to the footer only)', () => {
  it('no crisis box in the explorer, even for Mental health or crisis results', async () => {
    mockFetch([
      { path: '/api/resources/search', body: searchResponse({ items: [summary({ service_types: ['mental_health_counseling'] })] }) },
    ]);
    renderApp(<ExplorerPage />, { route: '/find?service_group=mental_health&lat=38.86&lon=-77.099', path: '/find' });
    await screen.findByRole('link', { name: '[TEST] Maple Community Pantry' });
    expect(screen.queryByTestId('crisis-callout')).toBeNull();
  });

  it('no crisis box on a listing that offers crisis services', async () => {
    const base = detailFixture();
    mockFetch([
      {
        path: '/api/resources/1',
        body: { ...base, service_types: ['crisis_support'], services: [{ ...base.services[0], service_type: 'crisis_support' }] },
      },
      { path: '/api/resources/1/visit-plan', body: visitPlan },
    ]);
    renderApp(<ResourcePage />, { route: '/resource/1', path: '/resource/:id' });
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByTestId('crisis-callout')).toBeNull();
  });
});

describe('admin AI settings', () => {
  const base: AISettings = {
    enabled: false,
    active: false,
    model: 'claude-sonnet-5-5',
    allowed_models: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'],
    key_source: 'none',
    key_hint: null,
  };
  const withKey: AISettings = { ...base, enabled: true, active: true, key_source: 'admin', key_hint: '…WXYZ' };

  it('saves a key (password field, never echoed), shows the hint + test result and re-fetches features', async () => {
    const secret = 'sk-ant-api03-abcdefghijklmnopqrstuvWXYZ';
    const { calls } = mockFetch(
      [
        { path: '/api/admin/ai-settings', body: base },
        { method: 'PUT', path: '/api/admin/ai-settings/key', body: { ...withKey, test: { ok: true, model: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5' } } },
      ],
      { user: admin },
    );
    renderApp(<AdminRoutes />, { route: '/admin/ai', path: '/admin/*' });
    expect(await screen.findByTestId('ai-state')).toHaveTextContent('No key');
    const input = screen.getByLabelText('Anthropic API key');
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveAttribute('autocomplete', 'off');
    const featuresBefore = calls.filter((c) => c.url.pathname === '/api/meta/features').length;
    await userEvent.type(input, secret);
    await userEvent.click(screen.getByRole('button', { name: 'Save & test' }));
    expect(await screen.findByTestId('ai-test-result')).toHaveTextContent('Connection works: Claude Sonnet 5.5.');
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ api_key: secret });
    expect(screen.getByTestId('ai-key-hint')).toHaveTextContent('…WXYZ');
    expect(screen.getByTestId('ai-state')).toHaveTextContent('Active');
    expect(input).toHaveValue('');
    expect(document.body.textContent).not.toContain(secret);
    await waitFor(() => expect(calls.filter((c) => c.url.pathname === '/api/meta/features').length).toBeGreaterThan(featuresBefore));
  });

  it('shows a failed test, toggles AI off, changes model and removes the key after an in-page confirmation', async () => {
    const { calls } = mockFetch(
      [
        { path: '/api/admin/ai-settings', body: withKey },
        { method: 'POST', path: '/api/admin/ai-settings/test', body: { ok: false, error: 'The API key was rejected by Anthropic' } },
        { method: 'PATCH', path: '/api/admin/ai-settings', body: (_u: URL, init?: RequestInit) => ({ ...withKey, ...JSON.parse(String(init!.body)), active: false }) },
        { method: 'DELETE', path: '/api/admin/ai-settings/key', body: base },
      ],
      { user: admin },
    );
    const confirmSpy = vi.spyOn(window, 'confirm');
    renderApp(<AdminRoutes />, { route: '/admin/ai', path: '/admin/*' });
    await screen.findByTestId('ai-key-hint');
    await userEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(await screen.findByTestId('ai-test-result')).toHaveTextContent('The API key was rejected by Anthropic');

    await userEvent.click(screen.getByRole('switch', { name: 'Turn on AI helpers' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ enabled: false }));
    expect(await screen.findByText('AI helpers are off.')).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Model'), 'claude-haiku-5-5');
    await waitFor(() => expect(calls.filter((c) => c.method === 'PATCH').at(-1)?.body).toEqual({ model: 'claude-haiku-5-5' }));

    await userEvent.click(screen.getByRole('button', { name: 'Remove key' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    expect(screen.getByText('Remove the saved key?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Yes, remove key' }));
    expect(await screen.findByText('Key removed. AI helpers are off.')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'DELETE' && c.url.pathname === '/api/admin/ai-settings/key')).toBe(true);
    expect(screen.getByTestId('ai-state')).toHaveTextContent('No key');
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});

describe('catalogs cover every new code', () => {
  it('en and es label every service type, service group, need and the crisis/AI strings', () => {
    for (const cat of [en, es] as Record<string, Record<string, unknown>>[]) {
      for (const code of Object.keys(SERVICE_TYPES)) expect(cat.serviceType).toHaveProperty(code);
      for (const g of SERVICE_GROUPS) expect(cat.serviceGroup).toHaveProperty(g);
      for (const n of NEEDS) {
        expect(cat.needs).toHaveProperty(`${n.id}.label`);
        expect(cat.needs).toHaveProperty(`${n.id}.hint`);
      }
      for (const k of ['title', 'body', 'call988', 'text988', 'call911']) expect(cat.crisis).toHaveProperty(k);
      for (const m of ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'])
        expect((cat.admin as Record<string, Record<string, Record<string, string>>>).aiSettings.models).toHaveProperty([m]);
    }
    expect(es.crisis.body).toContain('988');
    expect(es.crisis.body).toContain('En una emergencia, llame al 911.');
    expect(en.app.tagline).toBe('One place to find food, health and support near you');
  });
});
