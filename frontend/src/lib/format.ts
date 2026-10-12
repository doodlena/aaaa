/** Locale-aware formatting helpers. Dates from the API are local (America/New_York) calendar dates. */

const localeOf = (lang: string) => (lang === 'es' ? 'es-US' : 'en-US');

export function parseDate(d: string): Date {
  // 'YYYY-MM-DD' → local date at noon (avoids timezone day shifts)
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    const [y, m, day] = d.split('-').map(Number);
    return new Date(y, m - 1, day, 12);
  }
  return new Date(d);
}

export function formatDate(d: string | null | undefined, lang: string, opts?: Intl.DateTimeFormatOptions): string {
  if (!d) return '';
  const date = parseDate(d);
  if (Number.isNaN(date.getTime())) return d;
  return new Intl.DateTimeFormat(localeOf(lang), opts || { weekday: 'long', month: 'long', day: 'numeric' }).format(date);
}

export function formatDateTime(d: string | null | undefined, lang: string): string {
  if (!d) return '';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return d;
  return new Intl.DateTimeFormat(localeOf(lang), { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export function formatTime(hhmm: string | null | undefined, lang: string): string {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(2000, 0, 1, h, m);
  return new Intl.DateTimeFormat(localeOf(lang), { hour: 'numeric', minute: '2-digit' }).format(d);
}

export function formatTimeRange(opens: string | null, closes: string | null, lang: string): string {
  if (!opens && !closes) return '';
  if (opens && closes) return `${formatTime(opens, lang)} – ${formatTime(closes, lang)}`;
  return formatTime(opens || closes, lang);
}

/** 0=Monday … 6=Sunday (backend convention) → localized weekday name. */
export function weekdayName(weekday: number, lang: string, style: 'long' | 'short' = 'long'): string {
  // 2024-01-01 was a Monday
  const d = new Date(2024, 0, 1 + weekday, 12);
  return new Intl.DateTimeFormat(localeOf(lang), { weekday: style }).format(d);
}

export function formatDistance(km: number | null | undefined, lang: string): string {
  if (km === null || km === undefined) return '';
  const miles = km * 0.621371;
  const n = new Intl.NumberFormat(localeOf(lang), { maximumFractionDigits: miles < 10 ? 1 : 0 });
  return `${n.format(miles)} mi`;
}

export function formatAddress(a: { address1: string | null; address2?: string | null; city: string | null; state?: string | null; zip: string | null }): string {
  const line1 = [a.address1, a.address2].filter(Boolean).join(', ');
  const line2 = [a.city, [a.state, a.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return [line1, line2].filter(Boolean).join(', ');
}

export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

/** Only allow http(s) links from data to be rendered as anchors. */
export function safeUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  try {
    const parsed = new URL(u);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/** Whole minutes since an ISO timestamp (never negative). */
export function minutesSince(iso: string, now: number = Date.now()): number {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((now - t) / 60000));
}

/** "just now" / "12 min ago" / "2 h ago" / "3 d ago" via i18n keys time.*. */
export function timeAgo(iso: string, t: (k: string, o?: Record<string, unknown>) => string, now: number = Date.now()): string {
  const m = minutesSince(iso, now);
  if (m < 1) return t('time.justNow');
  if (m < 60) return t('time.minutesAgo', { count: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t('time.hoursAgo', { count: h });
  return t('time.daysAgo', { count: Math.floor(h / 24) });
}

/** Local "YYYY-MM-DDTHH:MM" for <input type="datetime-local">. */
export function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** End of today (23:59) in the browser's local time, as a datetime-local value. */
export function endOfTodayInput(): string {
  const d = new Date();
  d.setHours(23, 59, 0, 0);
  return toLocalInput(d);
}

/** datetime-local value → ISO string with the browser's offset (the API stores timestamps with time zones). */
export function localInputToISO(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
