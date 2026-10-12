import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import type { User } from '../api/types';
import { isSupported, persistLanguage, type LangCode } from '../i18n';

interface AuthValue {
  user: User | null;
  loading: boolean;
  login(email: string, password: string): Promise<User>;
  register(email: string, password: string): Promise<User>;
  logout(): Promise<void>;
  setUser(u: User | null): void;
  /** Change UI language: persists locally and, when signed in, to the account. */
  changeLanguage(code: LangCode): Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    api
      .me()
      .then((r) => alive && setUser(r.user))
      .catch(() => alive && setUser(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const adoptAccountLanguage = useCallback(
    (u: User) => {
      if (isSupported(u.preferred_language) && u.preferred_language !== i18n.language) {
        void i18n.changeLanguage(u.preferred_language);
        persistLanguage(u.preferred_language);
      }
    },
    [i18n],
  );

  const login = useCallback(
    async (email: string, password: string) => {
      const u = await api.login(email, password);
      setUser(u);
      adoptAccountLanguage(u);
      return u;
    },
    [adoptAccountLanguage],
  );

  const register = useCallback(
    async (email: string, password: string) => {
      const u = await api.register(email, password, isSupported(i18n.language) ? i18n.language : 'en');
      setUser(u);
      return u;
    },
    [i18n.language],
  );

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setUser(null);
    }
  }, []);

  const changeLanguage = useCallback(
    async (code: LangCode) => {
      await i18n.changeLanguage(code);
      persistLanguage(code);
      if (user && user.preferred_language !== code) {
        try {
          const updated = await api.updatePreferences({ preferred_language: code });
          setUser(updated);
        } catch {
          /* language still changes locally; account sync is best-effort */
        }
      }
    },
    [i18n, user],
  );

  const value = useMemo(
    () => ({ user, loading, login, register, logout, setUser, changeLanguage }),
    [user, loading, login, register, logout, changeLanguage],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(AuthContext);
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>');
  return v;
}
