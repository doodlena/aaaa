import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useTranslation } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import en from '../i18n/locales/en.json';
import es from '../i18n/locales/es.json';
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

  it('has complete, matching English and Spanish catalogs', () => {
    const a = flatKeys(en).sort();
    const b = flatKeys(es).sort();
    expect(b).toEqual(a);
    const empty = flatKeys(es).filter((k) => !k.split('.').reduce<unknown>((o, p) => (o as Record<string, unknown>)[p], es));
    expect(empty).toEqual([]);
  });
});
