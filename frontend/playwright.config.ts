import { defineConfig, devices } from '@playwright/test';

/**
 * E2E tests run against the REAL backend (http://localhost:8000) through the Vite dev server proxy. Start the backend
 * first; Playwright starts (or reuses) Vite on :5173.
 * - real-data.spec.ts is read-only and works on the real imported listings.
 * - Scenarios that need the fictional [TEST] data skip themselves unless /api/meta/features reports demo_mode
 *   (API started with FOODACCESS_SHOW_SYNTHETIC=true).
 * - global-setup.ts signs in once per account and saves the sessions (sign-ins are rate-limited per IP).
 */
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1, // scenarios share one dev database; admin scenario mutates review state
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:5173',
    trace: 'retain-on-failure',
    locale: 'en-US',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
