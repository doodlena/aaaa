import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '../api/client';
import type { VerificationMeta } from '../api/types';

interface MetaValue {
  meta: VerificationMeta | null;
  error: boolean;
}

const MetaContext = createContext<MetaValue>({ meta: null, error: false });

/** Loads /api/meta/verification once (demo_mode banner, fresh_days, data sources). */
export function MetaProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MetaValue>({ meta: null, error: false });
  useEffect(() => {
    let alive = true;
    api
      .verificationMeta()
      .then((meta) => alive && setState({ meta, error: false }))
      .catch(() => alive && setState({ meta: null, error: true }));
    return () => {
      alive = false;
    };
  }, []);
  return <MetaContext.Provider value={state}>{children}</MetaContext.Provider>;
}

export const useMeta = () => useContext(MetaContext);
