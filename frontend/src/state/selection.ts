import { useSyncExternalStore } from 'react';

/**
 * Shared selection between the map and the results list.
 * `origin` records who made the selection so the *other* view reacts (list scrolls when the map selects, map pans when
 * the list selects) without feedback loops.
 */
export type SelectionOrigin = 'map' | 'list' | 'url';
export interface SelectionState {
  id: number | null;
  origin: SelectionOrigin | null;
  /** Increments on every select() so re-selecting the same item still re-triggers effects (e.g. re-pan). */
  seq: number;
}

export interface SelectionStore {
  get(): SelectionState;
  select(id: number | null, origin: SelectionOrigin): void;
  clear(): void;
  subscribe(fn: () => void): () => void;
}

export function createSelectionStore(): SelectionStore {
  let state: SelectionState = { id: null, origin: null, seq: 0 };
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  return {
    get: () => state,
    select(id, origin) {
      state = { id, origin: id === null ? null : origin, seq: state.seq + 1 };
      emit();
    },
    clear() {
      if (state.id === null) return;
      state = { id: null, origin: null, seq: state.seq + 1 };
      emit();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export function useSelection(store: SelectionStore): SelectionState {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
