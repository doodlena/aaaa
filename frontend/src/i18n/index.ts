import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import es from './locales/es.json';

/**
 * To add a language: add src/i18n/locales/<code>.json and register it here (and in LAZY_CATALOGS unless it is bundled).
 * `primary` languages are always-visible buttons; the rest sit behind the "+" menu and load on demand.
 * Every catalog must have the same keys as en.json (language.test.tsx checks this); a missing key falls back to English.
 */
export const SUPPORTED_LANGUAGES = [
  { code: 'en', native: 'English', locale: 'en-US', primary: true },
  { code: 'es', native: 'Español', locale: 'es-US', primary: true },
  { code: 'zh', native: '中文', locale: 'zh-CN', primary: false },
  { code: 'vi', native: 'Tiếng Việt', locale: 'vi-VN', primary: false },
  { code: 'ko', native: '한국어', locale: 'ko-KR', primary: false },
] as const;
export type LangCode = (typeof SUPPORTED_LANGUAGES)[number]['code'];
export const LANG_STORAGE_KEY = 'nfa_lang';

const LAZY_CATALOGS: Partial<Record<LangCode, () => Promise<{ default: Record<string, unknown> }>>> = {
  zh: () => import('./locales/zh.json'),
  vi: () => import('./locales/vi.json'),
  ko: () => import('./locales/ko.json'),
};

export function isSupported(code: string | null | undefined): code is LangCode {
  return !!code && SUPPORTED_LANGUAGES.some((l) => l.code === code);
}

/** BCP 47 locale for Intl date/number formatting in the given UI language. */
export function localeOf(lang: string): string {
  return SUPPORTED_LANGUAGES.find((l) => l.code === lang)?.locale ?? 'en-US';
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

/** Fetch a lazy catalog if it is not loaded yet. */
export async function loadLanguage(code: LangCode): Promise<void> {
  const loader = LAZY_CATALOGS[code];
  if (!loader || i18n.hasResourceBundle(code, 'translation')) return;
  const catalog = await loader();
  i18n.addResourceBundle(code, 'translation', catalog.default, true, true);
}

/** Switch the UI language (loading its catalog first) and remember the choice on this device. */
export async function setLanguage(code: LangCode): Promise<void> {
  await loadLanguage(code);
  await i18n.changeLanguage(code);
  persistLanguage(code);
}

const initial = initialLanguage();

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, es: { translation: es } },
  lng: initial in LAZY_CATALOGS ? 'en' : initial,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

if (typeof document !== 'undefined') document.documentElement.lang = i18n.language;
// A lazy language starts in English and switches as soon as its catalog arrives; if that fails, English stays.
if (initial in LAZY_CATALOGS) void setLanguage(initial).catch(() => undefined);

export default i18n;
