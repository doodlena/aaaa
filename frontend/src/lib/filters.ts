import type { SavedPreferences } from '../api/types';

/** Codes mirrored from backend/app/vocab.py and backend/app/geospatial/search.py (ELIGIBILITY_FILTERS). */
export const FOOD_GROUPS = ['groceries', 'produce', 'protein', 'dairy', 'bakery', 'prepared_meals', 'infant', 'special_diet'] as const;
export const SERVICE_GROUPS = [
  'pantry',
  'walk_up',
  'drive_through',
  'mobile',
  'community_meal',
  'delivery',
  'emergency',
  'school',
  'seasonal',
  'voucher',
  'non_food',
  'referral',
  'other',
] as const;
export const ELIGIBILITY_FILTERS = [
  'no_id_required',
  'no_income_docs_required',
  'no_proof_of_address_required',
  'no_appointment_required',
  'no_referral_required',
  'no_residency_restriction',
  'student_affiliation',
] as const;
export const SORTS = ['distance', 'next_distribution', 'relevance', 'name'] as const;
/** Distance choices shown to people, in miles; the API takes kilometres. */
export const RADII_MILES = [1, 3, 5, 10, 25] as const;
export const milesToKm = (mi: number) => Math.round(mi * 1.609344 * 100) / 100;
export const kmToMiles = (km: number) => Math.round((km / 1.609344) * 10) / 10;
export const RADII = RADII_MILES.map(milesToKm);
export const LANGUAGE_FILTERS = ['es', 'en', 'am', 'ar', 'fa', 'ko', 'vi', 'zh', 'fr', 'ur'] as const;

export type ScheduleMode = 'any' | 'today' | 'date' | 'upcoming';

export interface Filters {
  lat: number | null;
  lon: number | null;
  label: string; // human label of the searched place (display only, never sent to the API)
  radius_km: number;
  bbox: [number, number, number, number] | null;
  jurisdiction: string;
  food_groups: string[];
  service_groups: string[];
  eligibility: string[];
  schedule: ScheduleMode;
  date: string; // YYYY-MM-DD when schedule === 'date'
  wheelchair: boolean;
  language: string;
  sort: string;
  page: number;
}

export const DEFAULT_FILTERS: Filters = {
  lat: null,
  lon: null,
  label: '',
  radius_km: milesToKm(5),
  bbox: null,
  jurisdiction: '',
  food_groups: [],
  service_groups: [],
  eligibility: [],
  schedule: 'any',
  date: '',
  wheelchair: false,
  language: '',
  sort: 'distance',
  page: 1,
};

const list = (v: string | null, allowed: readonly string[]) =>
  (v || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && allowed.includes(s));

const num = (v: string | null): number | null => {
  if (v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Parse the explorer's URL (?lat&lon&radius_km&food_group=…) into a Filters object, ignoring invalid values. */
export function filtersFromURL(sp: URLSearchParams): Filters {
  const lat = num(sp.get('lat'));
  const lon = num(sp.get('lon'));
  const radius = num(sp.get('radius_km'));
  const bboxParts = (sp.get('bbox') || '').split(',').map(Number);
  const bbox = bboxParts.length === 4 && bboxParts.every(Number.isFinite) ? (bboxParts as Filters['bbox']) : null;
  const schedule = (['today', 'date', 'upcoming'] as const).find((m) => m === sp.get('schedule')) || 'any';
  const date = sp.get('date') || '';
  const sort = sp.get('sort') || 'distance';
  const page = num(sp.get('page'));
  return {
    lat: lat !== null && lat >= -90 && lat <= 90 ? lat : null,
    lon: lon !== null && lon >= -180 && lon <= 180 ? lon : null,
    label: sp.get('label') || '',
    radius_km: radius && radius > 0 && radius <= 80 ? radius : DEFAULT_FILTERS.radius_km,
    bbox,
    jurisdiction: sp.get('jurisdiction') || '',
    food_groups: list(sp.get('food_group'), FOOD_GROUPS),
    service_groups: list(sp.get('service_group'), SERVICE_GROUPS),
    eligibility: list(sp.get('eligibility'), ELIGIBILITY_FILTERS),
    schedule: schedule === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(date) ? 'any' : schedule,
    date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '',
    wheelchair: sp.get('wheelchair') === 'true',
    language: sp.get('language') || '',
    sort: (SORTS as readonly string[]).includes(sort) ? sort : 'distance',
    page: page && page >= 1 ? Math.floor(page) : 1,
  };
}

/** Serialise Filters for the explorer URL (shareable, bookmarkable). */
export function filtersToURL(f: Filters): URLSearchParams {
  const sp = new URLSearchParams();
  if (f.lat !== null && f.lon !== null) {
    sp.set('lat', String(round(f.lat)));
    sp.set('lon', String(round(f.lon)));
  }
  if (f.label) sp.set('label', f.label);
  if (f.radius_km !== DEFAULT_FILTERS.radius_km) sp.set('radius_km', String(f.radius_km));
  if (f.bbox) sp.set('bbox', f.bbox.map(round).join(','));
  if (f.jurisdiction) sp.set('jurisdiction', f.jurisdiction);
  if (f.food_groups.length) sp.set('food_group', f.food_groups.join(','));
  if (f.service_groups.length) sp.set('service_group', f.service_groups.join(','));
  if (f.eligibility.length) sp.set('eligibility', f.eligibility.join(','));
  if (f.schedule !== 'any') sp.set('schedule', f.schedule);
  if (f.schedule === 'date' && f.date) sp.set('date', f.date);
  if (f.wheelchair) sp.set('wheelchair', 'true');
  if (f.language) sp.set('language', f.language);
  if (f.sort !== 'distance') sp.set('sort', f.sort);
  if (f.page > 1) sp.set('page', String(f.page));
  return sp;
}

/** Build the exact query string for GET /api/resources/search. */
export function buildSearchQuery(f: Filters, pageSize = 50): string {
  const sp = new URLSearchParams();
  if (f.lat !== null && f.lon !== null) {
    sp.set('lat', String(f.lat));
    sp.set('lon', String(f.lon));
    sp.set('radius_km', String(f.radius_km));
  }
  if (f.bbox) sp.set('bbox', f.bbox.join(','));
  if (f.jurisdiction) sp.set('jurisdiction', f.jurisdiction);
  if (f.food_groups.length) sp.set('food_group', f.food_groups.join(','));
  if (f.service_groups.length) sp.set('service_group', f.service_groups.join(','));
  if (f.eligibility.length) sp.set('eligibility', f.eligibility.join(','));
  if (f.schedule === 'today') sp.set('open_today', 'true');
  if (f.schedule === 'date' && f.date) sp.set('date', f.date);
  if (f.schedule === 'upcoming') sp.set('upcoming_days', '7');
  if (f.wheelchair) sp.set('wheelchair', 'true');
  if (f.language) sp.set('language', f.language);
  // Distance sort needs a reference point; fall back to soonest distribution otherwise.
  const sort = f.sort === 'distance' && (f.lat === null || f.lon === null) ? 'name' : f.sort;
  sp.set('sort', sort);
  sp.set('include_uncertain', 'true');
  sp.set('page', String(f.page));
  sp.set('page_size', String(pageSize));
  return sp.toString();
}

/** Count of filters a person has narrowed (for the "Filters (3)" button). */
export function activeFilterCount(f: Filters): number {
  return (
    f.food_groups.length +
    f.service_groups.length +
    f.eligibility.length +
    (f.schedule !== 'any' ? 1 : 0) +
    (f.wheelchair ? 1 : 0) +
    (f.language ? 1 : 0)
  );
}

export function applyPreferences(f: Filters, p: SavedPreferences | undefined | null): Filters {
  if (!p) return f;
  return {
    ...f,
    radius_km: typeof p.radius_km === 'number' && p.radius_km > 0 && p.radius_km <= 80 ? p.radius_km : f.radius_km,
    food_groups: (p.food_groups || []).filter((x) => (FOOD_GROUPS as readonly string[]).includes(x)),
    service_groups: (p.service_groups || []).filter((x) => (SERVICE_GROUPS as readonly string[]).includes(x)),
    eligibility: (p.eligibility || []).filter((x) => (ELIGIBILITY_FILTERS as readonly string[]).includes(x)),
    sort: p.sort && (SORTS as readonly string[]).includes(p.sort) ? p.sort : f.sort,
    wheelchair: !!p.wheelchair,
    language: p.language_filter || '',
  };
}

function round(n: number): number {
  return Math.round(n * 1e5) / 1e5;
}

export function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}
