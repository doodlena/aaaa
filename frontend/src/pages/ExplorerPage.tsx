import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { api } from '../api/client';
import { FiltersPanel } from '../components/FiltersPanel';
import { Icon } from '../components/Icon';
import { ResourceDetailView } from '../components/ResourceDetail';
import { ResultsList } from '../components/ResultsList';
import { SearchForm } from '../components/SearchForm';
import { ErrorMessage, Loading } from '../components/Status';
import {
  activeFilterCount,
  buildSearchQuery,
  DEFAULT_FILTERS,
  filtersFromURL,
  filtersToURL,
  RADII,
  kmToMiles,
  SORTS,
  type Filters,
} from '../lib/filters';
import { formatAddress } from '../lib/format';
import { useAsync } from '../lib/useAsync';
import { useMediaQuery } from '../lib/useMediaQuery';
import { createSelectionStore, useSelection } from '../state/selection';

const MapView = lazy(() => import('../components/MapView'));
export const PAGE_SIZE = 25;

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

  const nFilters = activeFilterCount(filters);
  const center = filters.lat !== null && filters.lon !== null ? { lat: filters.lat, lon: filters.lon } : null;
  const selected = data && sel.id !== null ? [...data.items, ...data.uncertain].find((r) => r.id === sel.id) : undefined;
  const placeLabel = filters.bbox ? t('explorer.thisArea') : filters.label || jurisdictionName;

  return (
    <div className={`explorer ${narrow ? `explorer--${mobileView}` : ''}`}>
      <div className="explorer__bar">
        <h1 className="explorer__title">
          {placeLabel ? t('explorer.titleNear', { place: placeLabel }) : t('explorer.title')}
        </h1>
        <SearchForm compact />
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
          {filters.bbox && (
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
              items={data?.items || []}
              uncertain={data?.uncertain || []}
              indexOffset={data ? (data.page - 1) * data.page_size + 1 : 1}
              center={center}
              radiusKm={filters.bbox ? null : filters.radius_km}
              store={store}
              onSearchArea={(bbox) => update({ bbox })}
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
    sort: f.lat !== null ? DEFAULT_FILTERS.sort : 'name',
  };
}
