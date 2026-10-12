import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import es from './locales/es.json';

/** To add a language: add src/i18n/locales/<code>.json with the same keys and register it here. */
export const SUPPORTED_LANGUAGES = [
  { code: 'en', native: 'English' },
  { code: 'es', native: 'Español' },
] as const;
export type LangCode = (typeof SUPPORTED_LANGUAGES)[number]['code'];
export const LANG_STORAGE_KEY = 'nfa_lang';

export function isSupported(code: string | null | undefined): code is LangCode {
  return !!code && SUPPORTED_LANGUAGES.some((l) => l.code === code);
}

export function initialLanguage(): LangCode {
  try {
    const stored = localStorage.getItem(LANG_STORAGE_KEY);
    if (isSupported(stored)) return stored;
  } catch {
    /* storage unavailable */
  }
  const nav = typeof navigator !== 'undefined' ? navigator.language?.slice(0, 2) : 'en';
  return isSupported(nav) ? nav : 'en';
}

export function persistLanguage(code: LangCode) {
  try {
    localStorage.setItem(LANG_STORAGE_KEY, code);
  } catch {
    /* ignore */
  }
  if (typeof document !== 'undefined') document.documentElement.lang = code;
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, es: { translation: es } },
  lng: initialLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

if (typeof document !== 'undefined') document.documentElement.lang = i18n.language;

export default i18n;
