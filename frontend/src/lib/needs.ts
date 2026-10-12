import { DEFAULT_FILTERS, filtersToURL, isFoodContext, toggle, type Filters } from './filters';
import type { IconName } from '../components/Icon';

/**
 * "What do you need?" tiles. Each need maps to exactly ONE filter. Several needs can be selected at once in the
 * explorer: the search then asks for places that offer ANY of them (need_match=any, see buildSearchQuery).
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

/** Whether the filters include this need (several needs can be selected together). */
export function needSelected(f: Pick<Filters, 'food_groups' | 'service_groups'>, need: Need): boolean {
  return need.service_group ? f.service_groups.includes(need.service_group) : !!need.food_group && f.food_groups.includes(need.food_group);
}

/** Filters patch that adds or removes one need, keeping the others. Leaving every food need drops the food-only filters. */
export function toggleNeedPatch(f: Filters, need: Need): Partial<Filters> {
  const service_groups = need.service_group ? toggle(f.service_groups, need.service_group) : f.service_groups;
  // Turning the food need off also clears "type of food" refinements, which only narrow that need.
  const food_groups = need.food_group ? (needSelected(f, need) ? [] : [...f.food_groups, need.food_group]) : f.food_groups;
  return {
    food_groups,
    service_groups,
    ...(isFoodContext({ food_groups, service_groups }) ? {} : { live_food_groups: [], live_open: false }),
    page: 1,
  };
}

/** /find URL for a need, starting from `base` (e.g. the current place). */
export function needURL(need: Need, base: Filters = DEFAULT_FILTERS): string {
  const next = { ...base, ...needPatch(need) };
  if (next.lat === null && !next.bbox && !next.jurisdiction) next.sort = 'name';
  return `/find?${filtersToURL(next).toString()}`;
}
