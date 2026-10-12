import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ResultsList } from '../components/ResultsList';
import { createSelectionStore, useSelection } from '../state/selection';
import { searchResponse, summary } from '../test/utils';

// ---- maplibre mock: records camera calls and lets the test fire marker clicks ----
const { FakeMap, FakeMarker, FakeBounds, FakePopup, mapInstances } = vi.hoisted(() => {
  class FakePopup {
    static opened: HTMLElement[] = [];
    setLngLat() { return this; }
    setDOMContent(el: HTMLElement) { FakePopup.opened.push(el); return this; }
    addTo() { return this; }
    remove() { return this; }
  }
  
const mapInstances: InstanceType<typeof FakeMap>[] = [];
  class FakeMap {
  handlers: Record<string, ((e?: unknown) => void)[]> = {};
  sources: Record<string, { setData: ReturnType<typeof vi.fn>; data: unknown; getClusterExpansionZoom: () => Promise<number> }> = {};
  easeTo = vi.fn();
  fitBounds = vi.fn();
  touchZoomRotate = { disableRotation: vi.fn() };
  constructor() {
    mapInstances.push(this);
  }
  addControl() {}
  on(ev: string, fn: (e?: unknown) => void) {
    (this.handlers[ev] ||= []).push(fn);
  }
  isStyleLoaded() {
    return true;
  }
  getSource(id: string) {
    return this.sources[id];
  }
  addSource(id: string, spec: { data: unknown }) {
    const src = { data: spec.data, setData: vi.fn((d: unknown) => (src.data = d)), getClusterExpansionZoom: async () => 14 };
    this.sources[id] = src;
  }
  addLayer() {}
  querySourceFeatures(id: string) {
    const d = this.sources[id]?.data as GeoJSON.FeatureCollection | undefined;
    return d?.features || [];
  }
  getZoom() {
    return 10;
  }
  getBounds() {
    return { getWest: () => -77.2, getSouth: () => 38.8, getEast: () => -77.0, getNorth: () => 38.9 };
  }
  setStyle() {}
  remove() {}
  emit(ev: string, e?: unknown) {
    (this.handlers[ev] || []).forEach((h) => h(e));
  }
}
  class FakeMarker {
  el: HTMLElement;
  constructor(opts: { element?: HTMLElement } = {}) {
    this.el = opts.element || document.createElement('div');
  }
  setLngLat() {
    return this;
  }
  addTo() {
    document.body.appendChild(this.el);
    return this;
  }
  remove() {
    this.el.remove();
  }
  getElement() {
    return this.el;
  }
}
  class FakeBounds {
  extend() {
    return this;
  }
}
  return { FakeMap, FakeMarker, FakeBounds, FakePopup, mapInstances };
});
vi.mock('maplibre-gl', () => ({
  default: { Map: FakeMap, Marker: FakeMarker, NavigationControl: class {}, LngLatBounds: FakeBounds, Popup: FakePopup },
  Map: FakeMap,
}));

import MapView from '../components/MapView';

describe('selection store', () => {
  it('notifies subscribers and records origin', () => {
    const store = createSelectionStore();
    const { result } = renderHook(() => useSelection(store));
    expect(result.current.id).toBeNull();
    act(() => store.select(5, 'map'));
    expect(result.current).toMatchObject({ id: 5, origin: 'map' });
    const seq = result.current.seq;
    act(() => store.select(5, 'map'));
    expect(result.current.seq).toBe(seq + 1); // re-selecting re-triggers effects
    act(() => store.clear());
    expect(result.current).toMatchObject({ id: null, origin: null });
  });
});

describe('list ↔ map synchronisation', () => {
  beforeEach(() => {
    mapInstances.length = 0;
  });

  it('list "Show on map" selects with origin=list and the map pans to it', () => {
    const store = createSelectionStore();
    const items = [summary({ id: 1 }), summary({ id: 2, name: 'Second', lat: 38.9, lon: -77.0 })];
    render(
      <MemoryRouter>
        <ResultsList data={searchResponse({ items, total: 2 })} store={store} />
        <MapView items={items} uncertain={[]} center={{ lat: 38.86, lon: -77.099 }} radiusKm={8} store={store} />
      </MemoryRouter>,
    );
    const map = mapInstances[0];
    act(() => map.emit('style.load'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Show on map' })[1]);
    expect(store.get()).toMatchObject({ id: 2, origin: 'list' });
    expect(map.easeTo).toHaveBeenCalledWith(expect.objectContaining({ center: [-77.0, 38.9] }));
    // the selected card is highlighted
    expect(screen.getByRole('link', { name: 'Second' }).closest('li')).toHaveClass('is-selected');
  });

  it('marker click selects with origin=map, highlights the card and scrolls it into view', () => {
    const store = createSelectionStore();
    const items = [summary({ id: 1 }), summary({ id: 2, name: 'Second', lat: 38.9, lon: -77.0 })];
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    render(
      <MemoryRouter>
        <ResultsList data={searchResponse({ items, total: 2 })} store={store} />
        <MapView items={items} uncertain={[]} center={null} radiusKm={null} store={store} />
      </MemoryRouter>,
    );
    const map = mapInstances[0];
    act(() => map.emit('style.load'));
    const marker = document.querySelector<HTMLElement>('.mk-wrap[data-id="2"]');
    expect(marker).not.toBeNull();
    expect(marker!.textContent).toBe('2'); // marker shows the list number, not just a colour
    act(() => marker!.click());
    expect(store.get()).toMatchObject({ id: 2, origin: 'map' });
    expect(scroll).toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Second' }).closest('li')).toHaveClass('is-selected');
    expect(marker).toHaveClass('is-selected');
    expect(map.easeTo).not.toHaveBeenCalled(); // map-originated selection does not re-pan
  });

  it('uncertain results get a distinct "?" marker', () => {
    const store = createSelectionStore();
    render(
      <MapView items={[]} uncertain={[summary({ id: 9, unconfirmed: ['no_id_required'] })]} center={null} radiusKm={null} store={store} />,
    );
    act(() => mapInstances[0].emit('style.load'));
    const m = document.querySelector('.mk-wrap[data-id="9"] .mk');
    expect(m).toHaveClass('mk--uncertain');
    expect(m!.textContent).toBe('?');
  });
});
