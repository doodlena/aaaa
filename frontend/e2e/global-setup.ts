import { request } from '@playwright/test';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { ADMIN, AUTH, BASE, STAFF } from './support';

/**
 * Sign in ONCE per run for each account and save the session cookies (storageState). Scenarios reuse them instead of
 * logging in again, which keeps the suite well under the API's sign-in rate limit (10 per 15 minutes per IP).
 * Only done in demo mode: the admin/pantry scenarios only ever touch [TEST] listings.
 */
export default async function globalSetup() {
  mkdirSync(dirname(AUTH.admin), { recursive: true });
  for (const f of Object.values(AUTH)) rmSync(f, { force: true });
  const probe = await request.newContext({ baseURL: BASE });
  const features = await probe.get('/api/meta/features');
  const demo = features.ok() && Boolean((await features.json()).demo_mode);
  await probe.dispose();
  if (!demo) return;
  for (const [who, creds] of [['admin', ADMIN], ['staff', STAFF]] as const) {
    const ctx = await request.newContext({ baseURL: BASE });
    const res = await ctx.post('/api/auth/login', { data: creds });
    if (res.ok()) await ctx.storageState({ path: AUTH[who] });
    else console.warn(`[e2e] sign-in for ${who} failed with HTTP ${res.status()}; scenarios that need it will fail.`);
    await ctx.dispose();
  }
}
