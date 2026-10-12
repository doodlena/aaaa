import { describe, expect, it } from 'vitest';
import { ANY_DISTANCE, activeFilterCount, buildSearchQuery, DEFAULT_FILTERS, filtersFromURL, filtersToURL, milesToKm } from '../lib/filters';

const parse = (q: string) => Object.fromEntries(new URLSearchParams(q));

describe('search filters → API query string', () => {
  it('builds location, radius and sort', () => {
    const q = parse(buildSearchQuery({ ...DEFAULT_FILTERS, lat: 38.86, lon: -77.099, radius_km: 8.05 }, 25));
    expect(q).toMatchObject({ lat: '38.86', lon: '-77.099', radius_km: '8.05', sort: 'distance', include_uncertain: 'true', page: '1', page_size: '25' });
  });

  it('joins multi-select groups with commas and maps schedule modes', () => {
    const f = {
      ...DEFAULT_FILTERS,
      lat: 1,
      lon: 2,
      food_groups: ['groceries', 'produce'],
      service_groups: ['pantry'],
      eligibility: ['no_id_required', 'no_appointment_required'],
      wheelchair: true,
      language: 'es',
    };
    expect(parse(buildSearchQuery({ ...f, schedule: 'today' }))).toMatchObject({
      food_group: 'groceries,produce',
      service_group: 'pantry',
      eligibility: 'no_id_required,no_appointment_required',
      open_today: 'true',
      wheelchair: 'true',
      language: 'es',
    });
    expect(parse(buildSearchQuery({ ...f, schedule: 'upcoming' })).upcoming_days).toBe('7');
    const dated = parse(buildSearchQuery({ ...f, schedule: 'date', date: '2026-10-20' }));
    expect(dated.date).toBe('2026-10-20');
    expect(dated.open_today).toBeUndefined();
  });

  it('omits empty filters and falls back from distance sort without a location', () => {
    const q = parse(buildSearchQuery({ ...DEFAULT_FILTERS, jurisdiction: 'arlington-county' }));
    expect(q.lat).toBeUndefined();
    expect(q.radius_km).toBeUndefined();
    expect(q.food_group).toBeUndefined();
    expect(q.jurisdiction).toBe('arlington-county');
    expect(q.sort).toBe('name');
  });

  it('sends a viewport bbox as minLon,minLat,maxLon,maxLat', () => {
    const q = parse(buildSearchQuery({ ...DEFAULT_FILTERS, lat: 38.86, lon: -77.1, bbox: [-77.2, 38.8, -77.0, 38.9] }));
    expect(q.bbox).toBe('-77.2,38.8,-77,38.9');
  });
});

describe('explorer URL state', () => {
  it('round-trips through the URL', () => {
    const f = { ...DEFAULT_FILTERS, lat: 38.86, lon: -77.099, label: 'ZIP 22204', radius_km: milesToKm(10), food_groups: ['groceries'], eligibility: ['no_id_required'], schedule: 'upcoming' as const, sort: 'next_distribution' };
    expect(filtersFromURL(filtersToURL(f))).toEqual(f);
  });

  it('"No limit" distance: radius_km=any in the URL, any_distance=true (and no radius) to the API', () => {
    const f = filtersFromURL(new URLSearchParams('lat=38.86&lon=-77.099&radius_km=any'));
    expect(f.radius_km).toBe(ANY_DISTANCE);
    expect(filtersToURL(f).get('radius_km')).toBe('any');
    const q = new URLSearchParams(buildSearchQuery(f, 25));
    expect(q.get('any_distance')).toBe('true');
    expect(q.get('radius_km')).toBeNull();
    expect(q.get('sort')).toBe('distance'); // still ordered from the searched place
    expect(new URLSearchParams(buildSearchQuery({ ...f, radius_km: milesToKm(5) }, 25)).get('any_distance')).toBeNull();
  });

  it('drops unknown codes and invalid values', () => {
    const f = filtersFromURL(new URLSearchParams('lat=999&lon=-77&food_group=groceries,bogus&eligibility=hack&sort=evil&radius_km=-3&schedule=date&date=nope'));
    expect(f.lat).toBeNull();
    expect(f.food_groups).toEqual(['groceries']);
    expect(f.eligibility).toEqual([]);
    expect(f.sort).toBe('distance');
    expect(f.radius_km).toBe(DEFAULT_FILTERS.radius_km);
    expect(f.schedule).toBe('any');
  });

  it('counts active filters', () => {
    expect(activeFilterCount({ ...DEFAULT_FILTERS, food_groups: ['a', 'b'], wheelchair: true, schedule: 'today' })).toBe(4);
  });
});
