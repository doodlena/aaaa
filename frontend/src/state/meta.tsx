import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '../api/client';
import type { Features, VerificationMeta } from '../api/types';

/** Brand fallback when /api/meta/features is unreachable. The real name always comes from the API (one config change). */
export const DEFAULT_APP_NAME = 'Lantern';

export const NO_AI: Features['ai'] = { search: false, listing_lookup: false, announcement_drafts: false, structure_suggestions: false, translation: false, model: null };

interface MetaValue {
  meta: VerificationMeta | null;
  error: boolean;
  features: Features | null;
  appName: string;
  /** Re-fetch /api/meta/features (e.g. after an admin turns AI on) so feature-flagged UI appears without a reload. */
  refreshFeatures: () => Promise<void>;
}

const MetaContext = createContext<MetaValue>({
  meta: null,
  error: false,
  features: null,
  appName: DEFAULT_APP_NAME,
  refreshFeatures: async () => {},
});

/** Loads /api/meta/verification (demo banner, fresh_days, sources) and /api/meta/features (brand name, AI switches) once. */
export function MetaProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ meta: VerificationMeta | null; error: boolean }>({ meta: null, error: false });
  const [features, setFeatures] = useState<Features | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .verificationMeta()
      .then((meta) => alive && setState({ meta, error: false }))
      .catch(() => alive && setState({ meta: null, error: true }));
    api
      .features()
      .then((f) => alive && setFeatures(f))
      .catch(() => alive && setFeatures(null));
    return () => {
      alive = false;
    };
  }, []);
  const refreshFeatures = useCallback(async () => {
    try {
      const [f, meta] = await Promise.all([api.features(), api.verificationMeta()]);
      setFeatures(f);
      setState({ meta, error: false });
    } catch {
      /* keep the previous switches */
    }
  }, []);
  const appName = features?.app_name?.trim() || DEFAULT_APP_NAME;
  return <MetaContext.Provider value={{ ...state, features, appName, refreshFeatures }}>{children}</MetaContext.Provider>;
}

export const useMeta = () => useContext(MetaContext);

/** Contact email for services/providers (configured on the server), or null. */
export function useContactEmail(): string | null {
  return useContext(MetaContext).features?.contact_email || null;
}

/** AI switches; everything is off until the server says otherwise. */
/** The configured OAuth sign-in provider, or null when the feature is off. `name` may be empty (use a generic label). */
export function useOAuth(): { name: string } | null {
  const o = useContext(MetaContext).features?.oauth;
  return o?.enabled ? { name: o.provider } : null;
}

/** Live provider updates (today's status, "on the shelf today" filters, the home feed). Off until the server says so. */
export function useProviderFeatures(): boolean {
  return !!useContext(MetaContext).features?.provider_features;
}

export function useAI(): Features['ai'] {
  return useContext(MetaContext).features?.ai ?? NO_AI;
}

/**
 * Sets document.title to "<page> · <app name>", or "<app name>: <tagline>" when page is null.
 * page === undefined leaves the title alone (e.g. a detail panel embedded in another page).
 */
export function useDocumentTitle(page?: string | null, tagline?: string) {
  const { appName } = useMeta();
  useEffect(() => {
    if (typeof document === 'undefined' || page === undefined) return;
    document.title = page ? `${page} · ${appName}` : tagline ? `${appName}: ${tagline}` : appName;
  }, [page, appName, tagline]);
}
