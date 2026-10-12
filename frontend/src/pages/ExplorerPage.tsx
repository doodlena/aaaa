import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { api } from '../api/client';
import { AISearch } from '../components/AISearch';
import { CrisisCallout } from '../components/CrisisCallout';
import { NeedsChooser } from '../components/NeedsChooser';
import { FiltersPanel } from '../components/FiltersPanel';
import { Icon } from '../components/Icon';
import { ResourceDetailView } from '../components/ResourceDetail';
import { ResultsList } from '../components/ResultsList';
import { SearchForm } from '../components/SearchForm';
import { ErrorMessage, Loading } from '../components/Status';
import {
  activeFilterCount,
  areaFilters,
  buildSearchQuery,
  offersCrisisServices,
  DEFAULT_FILTERS,
  filtersFromURL,
  filtersToURL,
  RADII,
  kmToMiles,
  SORTS,
  type Filters,
} from '../lib/filters';
import { formatAddress } from '../lib/format';
import { needPatch } from '../lib/needs';
import type { SearchResponse } from '../api/types';
import { useAsync } from '../lib/useAsync';
import { useMediaQuery } from '../lib/useMediaQuery';
import { createSelectionStore, useSelection } from '../state/selection';

const MapView = lazy(() => import('../components/MapView'));
export const PAGE_SIZE = 25;
/** Area views show every listing on the map: fetch up to this many (in pages of 100, the API maximum). */
const AREA_MAP_MAX = 500;

/** All confirmed + uncertain results for an area (map only; the list stays paginated). */
async function fetchAllForMap(f: Filters, signal: AbortSignal): Promise<SearchResponse> {
  const first = await api.search(buildSearchQuery({ ...f, page: 1 }, 100), signal);
  const items = [...first.items];
  for (let page = 2; items.length < first.total && items.length < AREA_MAP_MAX; page++) {
    const next = await api.search(buildSearchQuery({ ...f, page }, 100), signal);
    if (!next.items.length) break;
    items.push(...next.items);
  }
  return { ...first, items };
}

export default function ExplorerPage() {
  const { t } = useTranslation();
  const [sp, setSp] = useSearchParams();
  // Local copy updates instantly (controls never flicker while the router applies the URL change in a transition);
  // the URL stays the source of truth for back/forward and sharing.
  const [filters, setFilters] = useState(() => filtersFromURL(sp));
  const spKey = sp.toString();
  useEffect(() => {
    setFilters(filtersFromURL(new URLSearchParams(spKey)));
  }, [spKey]);
  const viewId = Number(sp.get('view')) || null;
  const query = buildSearchQuery(filters, PAGE_SIZE);
  const { data, error, loading, reload } = useAsync((signal) => api.search(query, signal), [query]);
  // Area view: the map shows the whole district, not just the current list page.
  const mapQuery = filters.area ? buildSearchQuery({ ...filters, page: 1 }, 100) : '';
  const areaMap = useAsync(
    (signal) => (filters.area ? fetchAllForMap(filters, signal) : Promise.resolve(null)),
    [mapQuery],
  );
  const store = useMemo(() => createSelectionStore(), []);
  const sel = useSelection(store);
  const narrow = useMediaQuery('(max-width: 899px)');
  const [mobileView, setMobileView] = useState<'list' | 'map'>('list');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersBtnRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  const update = useCallback(
    (patch: Partial<Filters>) => {
      const next = { ...filters, ...patch };
      if (!('page' in patch)) next.page = 1;
      setFilters(next);
      setSp(filtersToURL(next));
      store.clear();
    },
    [filters, setSp, store],
  );

  const open = useCallback(
    (id: number) => {
      const next = new URLSearchParams(sp);
      next.set('view', String(id));
      setSp(next);
      store.select(id, 'url');
    },
    [sp, setSp, store],
  );
  const closeDetail = () => {
    const next = new URLSearchParams(sp);
    next.delete('view');
    setSp(next);
  };

  // Mobile drawer: Escape closes, focus moves into it and back to the trigger.
  useEffect(() => {
    if (!filtersOpen || !narrow) return;
    const prev = document.activeElement as HTMLElement | null;
    drawerRef.current?.querySelector<HTMLElement>('button, input, select')?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFiltersOpen(false);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      (prev || filtersBtnRef.current)?.focus();
    };
  }, [filtersOpen, narrow]);

  // "Show on map" from the list on a phone switches to the map view.
  useEffect(() => {
    if (narrow && sel.origin === 'list' && sel.id !== null) setMobileView('map');
  }, [narrow, sel.id, sel.origin, sel.seq]);

  const jurisdictions = useAsync(() => api.jurisdictions(), []);
  const jurisdictionName = (Array.isArray(jurisdictions.data) ? jurisdictions.data : []).find((j) => j.id === filters.jurisdiction)?.name || filters.jurisdiction;
  const areas = useAsync(() => api.coverageAreas(), []);
  const areaList = Array.isArray(areas.data) ? areas.data : [];
  const areaName = filters.area ? areaList.find((a) => a.id === filters.area)?.name || filters.area : '';

  const nFilters = activeFilterCount(filters);
  const center = filters.lat !== null && filters.lon !== null ? { lat: filters.lat, lon: filters.lon } : null;
  const selected = data && sel.id !== null ? [...data.items, ...data.uncertain].find((r) => r.id === sel.id) : undefined;
  const placeLabel = areaName || (filters.bbox ? t('explorer.thisArea') : filters.label || jurisdictionName);
  const showCrisis =
    filters.service_groups.includes('mental_health') ||
    !!data?.items.some((r) => offersCrisisServices(r.service_types)) ||
    !!data?.uncertain.some((r) => offersCrisisServices(r.service_types));
  const mapItems = filters.area && areaMap.data ? areaMap.data.items : data?.items || [];
  const mapOffset = filters.area && areaMap.data ? 1 : data ? (data.page - 1) * data.page_size + 1 : 1;

  return (
    <div className={`explorer ${narrow ? `explorer--${mobileView}` : ''}`}>
      <div className="explorer__bar">
        <h1 className="explorer__title">
          {areaName ? t('area.title', { area: areaName }) : placeLabel ? t('explorer.titleNear', { place: placeLabel }) : t('explorer.title')}
        </h1>
        <SearchForm compact />
        <AISearch compact />
        <NeedsChooser variant="explorer" filters={filters} onSelect={(need) => update(need ? needPatch(need) : { food_groups: [], service_groups: [] })} />
        <div className="explorer__controls">
          <div className="field field--inline">
            <label htmlFor="radius">{t('explorer.radius')}</label>
            <select id="radius" value={filters.radius_km} disabled={!center || !!filters.bbox} onChange={(e) => update({ radius_km: Number(e.target.value) })}>
              {(RADII.includes(filters.radius_km) ? RADII : [...RADII, filters.radius_km].sort((a, b) => a - b)).map((r) => (
                <option key={r} value={r}>
                  {t('explorer.radiusOption', { miles: kmToMiles(r) })}
                </option>
              ))}
            </select>
          </div>
          {areaList.length > 0 && (
            <div className="field field--inline">
              <label htmlFor="area">{t('area.label')}</label>
              <select
                id="area"
                value={filters.area}
                onChange={(e) => update(e.target.value ? areaFilters(e.target.value) : { area: '', bbox: null })}
              >
                <option value="">{t('area.none')}</option>
                {areaList.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="field field--inline">
            <label htmlFor="sort">{t('explorer.sort')}</label>
            <select id="sort" value={filters.sort} onChange={(e) => update({ sort: e.target.value })}>
              {SORTS.map((s) => (
                <option key={s} value={s} disabled={s === 'distance' && !center}>
                  {t(`sort.${s}`)}
                </option>
              ))}
            </select>
          </div>
          {filters.bbox && !filters.area && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => update({ bbox: null })}>
              {t('explorer.backToRadius')}
            </button>
          )}
          <button
            ref={filtersBtnRef}
            type="button"
            className="btn btn--secondary explorer__filters-btn"
            aria-expanded={filtersOpen}
            aria-controls="filters-drawer"
            onClick={() => setFiltersOpen((o) => !o)}
          >
            <Icon name="filter" />
            {nFilters ? t('filters.buttonCount', { count: nFilters }) : t('filters.button')}
          </button>
        </div>
        {narrow && (
          <div className="viewtoggle" role="group" aria-label={t('explorer.viewToggle')}>
            <button type="button" aria-pressed={mobileView === 'list'} onClick={() => setMobileView('list')}>
              <Icon name="list" />
              {t('explorer.showList')}
            </button>
            <button type="button" aria-pressed={mobileView === 'map'} onClick={() => setMobileView('map')}>
              <Icon name="map" />
              {t('explorer.showMap')}
            </button>
          </div>
        )}
      </div>

      {showCrisis && (
        <div className="explorer__crisis">
          <CrisisCallout compact />
        </div>
      )}
      {filters.area && areaMap.data && (
        <p className="explorer__area-note" role="status">
          {t('area.mapNote', { count: areaMap.data.items.length, area: areaName })}
        </p>
      )}

      <div className="explorer__body">
        <aside
          id="filters-drawer"
          ref={drawerRef}
          className={`explorer__filters ${filtersOpen ? 'is-open' : ''}`}
          aria-label={t('filters.title')}
          {...(narrow && filtersOpen ? { role: 'dialog', 'aria-modal': true } : {})}
          hidden={narrow && !filtersOpen}
        >
          <div className="explorer__filters-head">
            <h2>{t('filters.title')}</h2>
            {narrow && (
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setFiltersOpen(false)}>
                <Icon name="close" />
                {t('common.close')}
              </button>
            )}
          </div>
          <FiltersPanel filters={filters} onChange={update} onClear={() => update({ ...clearedFilters(filters) })} />
          {narrow && (
            <button type="button" className="btn btn--primary btn--block explorer__filters-done" onClick={() => setFiltersOpen(false)}>
              {data ? t('filters.showResults', { count: data.total }) : t('common.close')}
            </button>
          )}
        </aside>

        <section className="explorer__list" aria-label={t('explorer.resultsLabel')}>
          {viewId ? (
            <div className="panel">
              <button type="button" className="btn btn--ghost btn--sm" onClick={closeDetail}>
                <Icon name="arrowLeft" />
                {t('explorer.backToResults')}
              </button>
              <ResourceDetailView id={viewId} headingLevel={2} />
            </div>
          ) : loading && !data ? (
            <Loading label={t('explorer.loading')} />
          ) : error ? (
            <ErrorMessage error={error} onRetry={reload} title={t('explorer.errorTitle')} />
          ) : data ? (
            <div aria-busy={loading}>
              {loading && <p className="results__refreshing" role="status">{t('explorer.updating')}</p>}
              <ResultsList
                data={data}
                store={store}
                onOpen={open}
                onPage={(page) => update({ page })}
                hasFilters={nFilters > 0}
                onClearFilters={() => update(clearedFilters(filters))}
              />
            </div>
          ) : null}
        </section>

        <div className="explorer__map">
          <Suspense fallback={<Loading label={t('map.loading')} />}>
            <MapView
              items={mapItems}
              uncertain={data?.uncertain || []}
              indexOffset={mapOffset}
              center={center}
              radiusKm={filters.bbox ? null : filters.radius_km}
              store={store}
              onSearchArea={(bbox) => update({ bbox, area: '' })}
            />
          </Suspense>
          {narrow && mobileView === 'map' && selected && (
            <div className="peek">
              <p className="peek__name">{selected.name}</p>
              <p className="peek__addr">{formatAddress(selected.address)}</p>
              <div className="peek__actions">
                <Link className="btn btn--primary btn--sm" to={`/resource/${selected.id}`}>
                  {t('card.details')}
                </Link>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => setMobileView('list')}>
                  {t('explorer.showInList')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function clearedFilters(f: Filters): Partial<Filters> {
  return {
    food_groups: [],
    service_groups: [],
    eligibility: [],
    schedule: 'any',
    date: '',
    wheelchair: false,
    language: '',
    live_open: false,
    live_food_groups: [],
    sort: f.lat !== null ? DEFAULT_FILTERS.sort : 'name',
  };
}
