import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useTranslation } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import en from '../i18n/locales/en.json';
import es from '../i18n/locales/es.json';
import ko from '../i18n/locales/ko.json';
import vi from '../i18n/locales/vi.json';
import zh from '../i18n/locales/zh.json';
import { mockFetch, renderApp, testUser } from '../test/utils';

function Probe() {
  const { t } = useTranslation();
  return (
    <>
      <LanguageSwitcher />
      <p>{t('detail.eligibility')}</p>
      <p>{t('eligibilityFilter.no_id_required')}</p>
      <p>{t('tristate.unknown')}</p>
    </>
  );
}

function flatKeys(o: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? flatKeys(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`]));
}

describe('language switching', () => {
  it('switches UI text to Spanish and remembers the choice', async () => {
    mockFetch([]);
    renderApp(<Probe />);
    expect(screen.getByText('Who can get help')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Español' }));
    expect(await screen.findByText('Quién puede recibir ayuda')).toBeInTheDocument();
    expect(screen.getByText('No se requiere identificación (confirmado)')).toBeInTheDocument();
    expect(screen.getByText('No confirmado')).toBeInTheDocument();
    expect(localStorage.getItem('nfa_lang')).toBe('es');
    expect(document.documentElement.lang).toBe('es');
    expect(screen.getByRole('button', { name: 'Español' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('saves the preference to the account (with CSRF header) when signed in', async () => {
    document.cookie = 'nfa_csrf=tok123; path=/';
    const { calls } = mockFetch([{ method: 'PATCH', path: '/api/me/preferences', body: { ...testUser, preferred_language: 'es' } }], { user: testUser });
    renderApp(<Probe />);
    await waitFor(() => expect(calls.some((c) => c.url.pathname === '/api/auth/me')).toBe(true));
    await new Promise((r) => setTimeout(r, 0));
    await userEvent.click(screen.getByRole('button', { name: 'Español' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(patch.body).toEqual({ preferred_language: 'es' });
    expect(patch.headers['X-CSRF-Token']).toBe('tok123');
  });

  it('keeps extra languages behind the "+" button and switches to the one picked', async () => {
    mockFetch([]);
    renderApp(<Probe />);
    expect(screen.queryByRole('button', { name: 'Tiếng Việt' })).not.toBeInTheDocument();
    const more = screen.getByRole('button', { name: 'More languages' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: '中文' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '한국어' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Tiếng Việt' }));
    expect(await screen.findByText('Ai được trợ giúp')).toBeInTheDocument();
    // "Unknown" must stay distinct from "not required" in every language
    expect(screen.getByText('Không cần giấy tờ tùy thân (đã xác nhận)')).toBeInTheDocument();
    expect(screen.getByText('Chưa xác nhận')).toBeInTheDocument();
    expect(localStorage.getItem('nfa_lang')).toBe('vi');
    expect(document.documentElement.lang).toBe('vi');
    // the menu closes and the chosen language joins the always-visible row
    expect(screen.getByRole('button', { name: 'Ngôn ngữ khác' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: 'Tiếng Việt' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: '中文' })).not.toBeInTheDocument();
  });

  it('closes the "+" menu with Escape', async () => {
    mockFetch([]);
    renderApp(<Probe />);
    const more = screen.getByRole('button', { name: 'More languages' });
    await userEvent.click(more);
    await userEvent.keyboard('{Escape}');
    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(more).toHaveFocus();
    expect(screen.queryByRole('button', { name: '한국어' })).not.toBeInTheDocument();
  });

  it.each([
    ['zh', zh],
    ['vi', vi],
    ['ko', ko],
  ])('has a complete catalog for %s with the same keys and placeholders as English', (_code, catalog) => {
    const at = (o: unknown, k: string) => k.split('.').reduce<unknown>((x, p) => (x as Record<string, unknown>)?.[p], o) as string;
    const expected = flatKeys(en);
    expect(flatKeys(catalog).sort()).toEqual(expected.sort());
    const vars = (s: string) => (s.match(/{{\w+}}/g) || []).sort();
    const bad = expected.filter((k) => !at(catalog, k) || vars(at(catalog, k)).join() !== vars(at(en, k)).join());
    expect(bad).toEqual([]);
    // tri-state: "unknown" and "not required" must never share wording
    expect(at(catalog, 'tristate.unknown')).not.toBe(at(catalog, 'tristate.not_required'));
  });

  it('has complete, matching English and Spanish catalogs', () => {
    const a = flatKeys(en).sort();
    const b = flatKeys(es).sort();
    expect(b).toEqual(a);
    const empty = flatKeys(es).filter((k) => !k.split('.').reduce<unknown>((o, p) => (o as Record<string, unknown>)[p], es));
    expect(empty).toEqual([]);
  });
});
