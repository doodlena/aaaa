import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import i18n from '../i18n';

// jsdom lacks these browser APIs
if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || function () {};
window.scrollTo = (() => {}) as typeof window.scrollTo;

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  document.cookie = 'nfa_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
  await i18n.changeLanguage('en');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
