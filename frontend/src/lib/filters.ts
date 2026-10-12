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
  // support beyond food (backend/app/vocab.py SERVICE_TYPES → "What do you need?" groups)
  'benefits',
  'health',
  'mental_health',
  'housing',
  'financial',
  'clothing',
  'legal',
  'work_learning',
  'family',
  'transportation',
  'other',
] as const;
/** Service groups that are about food (vocab.py FOOD_SERVICE_GROUPS + non_food supplies handed out by pantries). */
export const FOOD_SERVICE_GROUPS = [
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
] as const;
export const SUPPORT_SERVICE_GROUPS = SERVICE_GROUPS.filter((g) => !(FOOD_SERVICE_GROUPS as readonly string[]).includes(g));
/** Service type → group, mirrored from backend/app/vocab.py SERVICE_TYPES. */
export const SERVICE_TYPES: Record<string, string> = {
  pantry_pickup: 'pantry',
  walk_up: 'walk_up',
  drive_through: 'drive_through',
  mobile_pantry: 'mobile',
  community_meal: 'community_meal',
  home_delivery: 'delivery',
  delivery_qualifying: 'delivery',
  emergency_food: 'emergency',
  school_based: 'school',
  appointment_distribution: 'pantry',
  seasonal_program: 'seasonal',
  grocery_voucher: 'voucher',
  diapers: 'non_food',
  hygiene_supplies: 'non_food',
  household_essentials: 'non_food',
  food_referral: 'referral',
  snap_application_help: 'benefits',
  wic_services: 'benefits',
  medicaid_enrollment_help: 'benefits',
  senior_meals: 'community_meal',
  kids_meals: 'school',
  health_clinic: 'health',
  dental_care: 'health',
  prescription_help: 'health',
  mental_health_counseling: 'mental_health',
  crisis_support: 'mental_health',
  substance_use_treatment: 'mental_health',
  support_groups: 'mental_health',
  housing_assistance: 'housing',
  shelter: 'housing',
  utility_assistance: 'housing',
  financial_assistance: 'financial',
  tax_preparation: 'financial',
  clothing: 'clothing',
  legal_aid: 'legal',
  immigration_legal_help: 'legal',
  job_training: 'work_learning',
  esl_classes: 'work_learning',
  childcare: 'family',
  domestic_violence_support: 'family',
  transportation_help: 'transportation',
  other: 'other',
};
/** Service types that should always show the 988 / 911 crisis callout. */
export const CRISIS_SERVICE_TYPES = Object.keys(SERVICE_TYPES).filter((k) => SERVICE_TYPES[k] === 'mental_health');
export const offersCrisisServices = (serviceTypes: readonly string[] | null | undefined) =>
  (serviceTypes || []).some((s) => CRISIS_SERVICE_TYPES.includes(s));

/** Coverage areas the explorer can show as a whole (GET /api/coverage-areas). bbox = min_lon,min_lat,max_lon,max_lat. */
export const AREA_BBOX: Record<string, [number, number, number, number]> = {
  'va-08': [-77.24, 38.6, -77.03, 38.97],
};

/**
 * Food filters (type of food, "on the shelf today") only make sense for food needs: hide them when every selected
 * need is a non-food one (e.g. Legal & immigration).
 */
export function isFoodContext(f: Pick<Filters, 'service_groups' | 'food_groups'>): boolean {
  if (f.food_groups.length) return true;
  if (!f.service_groups.length) return true;
  return f.service_groups.some((g) => (FOOD_SERVICE_GROUPS as readonly string[]).includes(g));
}
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
  /** Coverage area id (e.g. va-08); always paired with that area's bbox. */
  area: string;
  food_groups: string[];
  service_groups: string[];
  eligibility: string[];
  schedule: ScheduleMode;
  date: string; // YYYY-MM-DD when schedule === 'date'
  wheelchair: boolean;
  language: string;
  /** Pantry posted "open" or "limited" today (live_open=true). */
  live_open: boolean;
  /** Food groups the pantry says are on the shelf today (live_food_group=…). */
  live_food_groups: string[];
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
  area: '',
  food_groups: [],
  service_groups: [],
  eligibility: [],
  schedule: 'any',
  date: '',
  wheelchair: false,
  language: '',
  live_open: false,
  live_food_groups: [],
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
    area: /^[a-z0-9-]{1,64}$/.test(sp.get('area') || '') ? (sp.get('area') as string) : '',
    food_groups: list(sp.get('food_group'), FOOD_GROUPS),
    service_groups: list(sp.get('service_group'), SERVICE_GROUPS),
    eligibility: list(sp.get('eligibility'), ELIGIBILITY_FILTERS),
    schedule: schedule === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(date) ? 'any' : schedule,
    date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '',
    wheelchair: sp.get('wheelchair') === 'true',
    language: sp.get('language') || '',
    live_open: sp.get('live_open') === 'true',
    live_food_groups: list(sp.get('live_food_group'), FOOD_GROUPS),
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
  if (f.area) sp.set('area', f.area);
  if (f.food_groups.length) sp.set('food_group', f.food_groups.join(','));
  if (f.service_groups.length) sp.set('service_group', f.service_groups.join(','));
  if (f.eligibility.length) sp.set('eligibility', f.eligibility.join(','));
  if (f.schedule !== 'any') sp.set('schedule', f.schedule);
  if (f.schedule === 'date' && f.date) sp.set('date', f.date);
  if (f.wheelchair) sp.set('wheelchair', 'true');
  if (f.language) sp.set('language', f.language);
  if (f.live_open) sp.set('live_open', 'true');
  if (f.live_food_groups.length) sp.set('live_food_group', f.live_food_groups.join(','));
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
  if (f.area) sp.set('area', f.area);
  if (f.food_groups.length) sp.set('food_group', f.food_groups.join(','));
  if (f.service_groups.length) sp.set('service_group', f.service_groups.join(','));
  if (f.eligibility.length) sp.set('eligibility', f.eligibility.join(','));
  if (f.schedule === 'today') sp.set('open_today', 'true');
  if (f.schedule === 'date' && f.date) sp.set('date', f.date);
  if (f.schedule === 'upcoming') sp.set('upcoming_days', '7');
  if (f.wheelchair) sp.set('wheelchair', 'true');
  if (f.language) sp.set('language', f.language);
  if (f.live_open) sp.set('live_open', 'true');
  if (f.live_food_groups.length) sp.set('live_food_group', f.live_food_groups.join(','));
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
    (f.language ? 1 : 0) +
    (f.live_open ? 1 : 0) +
    f.live_food_groups.length
  );
}

/** Filters for showing a whole coverage area (e.g. Virginia's 8th District): area id + its bbox, no radius. */
export function areaFilters(area: string): Partial<Filters> {
  return { area, bbox: AREA_BBOX[area] ?? null, lat: null, lon: null, label: '', jurisdiction: '', sort: 'name', page: 1 };
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

/** Food type → group, mirrored from backend/app/vocab.py FOOD_TYPES (order = picker order). */
export const FOOD_TYPES: Record<string, string> = {
  fresh_vegetables: 'produce',
  fresh_fruits: 'produce',
  eggs: 'dairy',
  dairy: 'dairy',
  meat: 'protein',
  poultry: 'protein',
  fish: 'protein',
  bread: 'bakery',
  baked_goods: 'bakery',
  general_groceries: 'groceries',
  pantry_staples: 'groceries',
  frozen_foods: 'groceries',
  emergency_food_packages: 'groceries',
  prepared_meals: 'prepared_meals',
  community_meals: 'prepared_meals',
  baby_formula: 'infant',
  infant_food: 'infant',
  culturally_specific: 'special_diet',
  vegetarian: 'special_diet',
  halal: 'special_diet',
  kosher: 'special_diet',
  other_special_diet: 'special_diet',
};

/** Food types grouped for pickers, in FOOD_GROUPS order. Unknown codes from the server go into their own group. */
export function groupFoodTypes(codes: string[] = Object.keys(FOOD_TYPES)): { group: string; types: string[] }[] {
  const out = new Map<string, string[]>();
  for (const g of FOOD_GROUPS) out.set(g, []);
  for (const c of codes) {
    const g = FOOD_TYPES[c] || 'groceries';
    if (!out.has(g)) out.set(g, []);
    out.get(g)!.push(c);
  }
  return [...out.entries()].filter(([, types]) => types.length).map(([group, types]) => ({ group, types }));
}
