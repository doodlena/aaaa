import { API_BASE } from '../api/client';

/**
 * Offline support (production builds only): public/sw.js caches the app shell and GET responses for pantry details and
 * visit plans, so a saved or recently viewed pantry's visit card opens without a connection.
 * It never caches /api/admin, /api/provider, /api/auth or /api/me.
 */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* offline support is optional */
    });
  });
}

/** Fetch detail + visit plan for these pantries so the service worker stores them (no-op without a worker). */
export function warmOfflineCache(ids: number[], lang?: string) {
  if (typeof navigator === 'undefined' || !navigator.serviceWorker?.controller) return;
  for (const id of ids.slice(0, 30)) {
    const q = lang && lang !== 'en' ? `?lang=${lang}` : '';
    void fetch(`${API_BASE}/resources/${id}${q}`, { credentials: 'same-origin' }).catch(() => undefined);
    void fetch(`${API_BASE}/resources/${id}/visit-plan`, { credentials: 'same-origin' }).catch(() => undefined);
  }
}
