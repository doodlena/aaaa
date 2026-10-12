import type { LiveShelf, ResourceDetail } from '../api/types';
import { summary } from '../test/utils';

export const liveOpen = (over: Partial<LiveShelf> = {}): LiveShelf => ({
  status: 'open',
  message: 'Fresh greens and eggs just arrived!',
  items: [
    { food_type: 'fresh_vegetables', level: 'plenty', group: 'produce' },
    { food_type: 'eggs', level: 'some', group: 'dairy' },
    { food_type: 'dairy', level: 'low', group: 'dairy' },
  ],
  posted_at: new Date(Date.now() - 2 * 3600_000 - 60_000).toISOString(),
  expires_at: new Date(Date.now() + 6 * 3600_000).toISOString(),
  source: 'pantry',
  ai_assisted: false,
  ...over,
});

export function detailFixture(overrides: Partial<ResourceDetail> = {}): ResourceDetail {
  return {
    ...summary({ id: 1, name: '[TEST] Maple Community Pantry — Main Site' }),
    organization: { name: '[TEST] Maple', public_name: null, website: null, phone: null, description: null, description_lang: null },
    location_website: null,
    email: null,
    registration_url: null,
    accessibility: { wheelchair_accessible: 'unknown', notes: null, parking: null, transit: null, entrance: null },
    notes: null,
    notes_lang: null,
    services: [],
    eligibility_details: [],
    schedules: { distribution: [], operating_hours: [] },
    upcoming_windows: [],
    exceptions: [],
    events: [],
    current_inventory: null,
    sources: [],
    translations: {},
    directions: null,
    ...overrides,
  };
}

export const visitPlan = {
  checklist: [
    { key: 'photo_id', action: 'not_needed' },
    { key: 'proof_of_address', action: 'ask' },
    { key: 'income_documentation', action: 'bring' },
    { key: 'benefit_documentation', action: 'ask' },
    { key: 'referral', action: 'ask' },
    { key: 'appointment', action: 'bring' },
    { key: 'registration', action: 'ask' },
  ],
  suggestions: ['bags', 'call_ahead'],
  next_windows: [{ date: '2026-10-13', opens: '10:00', closes: '13:00', kind: 'distribution', appointment_only: false }],
};
