import { request, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const BASE = process.env.E2E_BASE_URL || 'http://localhost:5173';
export const ADMIN = { email: process.env.E2E_ADMIN_EMAIL || 'admin@localhost.test', password: process.env.E2E_ADMIN_PASSWORD || 'dev-admin-password-1' };
export const STAFF = { email: process.env.E2E_PANTRY_EMAIL || 'pantry@localhost.test', password: process.env.E2E_PANTRY_PASSWORD || 'demo-pantry-password' };

/** Signed-in sessions are created ONCE per run by global-setup.ts (the API rate-limits sign-ins per IP). */
export const AUTH = {
  admin: fileURLToPath(new URL('./.auth/admin.json', import.meta.url)),
  staff: fileURLToPath(new URL('./.auth/staff.json', import.meta.url)),
};

export const SYNTHETIC_SKIP =
  'Needs the fictional [TEST] data: start the API with FOODACCESS_SHOW_SYNTHETIC=true (GET /api/meta/features → demo_mode is false).';

let demo: Promise<boolean> | null = null;
/** True when the API shows the synthetic [TEST] listings (GET /api/meta/features → demo_mode). */
export function demoMode(): Promise<boolean> {
  demo ??= (async () => {
    const ctx = await request.newContext({ baseURL: BASE });
    try {
      const res = await ctx.get('/api/meta/features');
      return res.ok() ? Boolean((await res.json()).demo_mode) : false;
    } finally {
      await ctx.dispose();
    }
  })();
  return demo;
}

/** Call at the top of a describe block: skips every test in it unless demo data is on. */
export function requireSyntheticData() {
  test.beforeEach(async () => {
    test.skip(!(await demoMode()), SYNTHETIC_SKIP);
  });
}

/** Path of a saved session, or a clear failure if global setup could not sign in. */
export function session(who: keyof typeof AUTH): string {
  if (!existsSync(AUTH[who])) throw new Error(`No saved ${who} session: global-setup could not sign in (wrong credentials or rate limit 429). Wait 15 minutes and re-run.`);
  return AUTH[who];
}
