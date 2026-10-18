import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import es from './locales/es.json';
import ko from './locales/ko.json';
import vi from './locales/vi.json';
import zh from './locales/zh.json';

/**
 * To add a language: add src/i18n/locales/<code>.json, import it here and add it to `resources` below.
 * `primary` languages are always-visible buttons; the rest sit behind the "+" menu. Every catalog is bundled (about
 * 24 KB gzipped each): loading them on demand failed silently on devices running a cached older version.
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


const RELOAD_KEY = 'nfa_reloaded_at';

/** Reload once to pick up a newly deployed version (never twice within a minute, so a real outage can't loop). */
export function reloadForNewVersion(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

/** Switch the UI language and remember the choice on this device. */
export async function setLanguage(code: LangCode): Promise<void> {
  await i18n.changeLanguage(code);
  persistLanguage(code);
}

const initial = initialLanguage();

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, es: { translation: es }, zh: { translation: zh }, vi: { translation: vi }, ko: { translation: ko } },
  lng: initial,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

if (typeof document !== 'undefined') document.documentElement.lang = i18n.language;

export default i18n;
