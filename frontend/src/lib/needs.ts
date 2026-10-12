import { DEFAULT_FILTERS, filtersToURL, type Filters } from './filters';
import type { IconName } from '../components/Icon';

/**
 * "What do you need?" tiles. Each need maps to exactly ONE filter (the search API ANDs service groups, so combining
 * needs in one tile would hide places that offer only one of them). Combinations live in the filter panel.
 */
export interface Need {
  id: string;
  icon: IconName;
  food_group?: string;
  service_group?: string;
  /** Food needs keep the food filters (type of food, "on the shelf today") visible. */
  food: boolean;
}

export const NEEDS: Need[] = [
  { id: 'food', icon: 'basket', food_group: 'groceries', food: true },
  { id: 'meals', icon: 'bowl', service_group: 'community_meal', food: true },
  // Diapers, formula and household items: pantries file diapers/hygiene under non_food. Formula (food_group=infant)
  // can be added from the filter panel; ANDing both here would hide diaper banks that don't stock formula.
  { id: 'baby', icon: 'baby', service_group: 'non_food', food: true },
  { id: 'benefits', icon: 'document', service_group: 'benefits', food: false },
  { id: 'health', icon: 'health', service_group: 'health', food: false },
  { id: 'mental_health', icon: 'heart', service_group: 'mental_health', food: false },
  { id: 'housing', icon: 'home', service_group: 'housing', food: false },
  { id: 'financial', icon: 'coin', service_group: 'financial', food: false },
  { id: 'clothing', icon: 'shirt', service_group: 'clothing', food: false },
  { id: 'legal', icon: 'scale', service_group: 'legal', food: false },
  { id: 'work_learning', icon: 'book', service_group: 'work_learning', food: false },
  { id: 'family', icon: 'family', service_group: 'family', food: false },
  { id: 'transportation', icon: 'bus', service_group: 'transportation', food: false },
  { id: 'pets', icon: 'paw', service_group: 'pets', food: false },
];

/** Filters patch for a need: replaces the need-related filters, keeps place/area. Non-food needs drop food filters. */
export function needPatch(need: Need): Partial<Filters> {
  return {
    food_groups: need.food_group ? [need.food_group] : [],
    service_groups: need.service_group ? [need.service_group] : [],
    ...(need.food ? {} : { live_food_groups: [], live_open: false }),
    page: 1,
  };
}

/** The need currently expressed by the filters (exactly one need filter set), if any. */
export function currentNeed(f: Pick<Filters, 'food_groups' | 'service_groups'>): Need | undefined {
  return NEEDS.find(
    (n) =>
      f.food_groups.length === (n.food_group ? 1 : 0) &&
      f.service_groups.length === (n.service_group ? 1 : 0) &&
      (!n.food_group || f.food_groups[0] === n.food_group) &&
      (!n.service_group || f.service_groups[0] === n.service_group),
  );
}

/** /find URL for a need, starting from `base` (e.g. the current place). */
export function needURL(need: Need, base: Filters = DEFAULT_FILTERS): string {
  const next = { ...base, ...needPatch(need) };
  if (next.lat === null && !next.bbox && !next.jurisdiction) next.sort = 'name';
  return `/find?${filtersToURL(next).toString()}`;
}
