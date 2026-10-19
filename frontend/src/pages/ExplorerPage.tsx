import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { api } from '../api/client';
import { AISearch } from '../components/AISearch';
import { NeedsChooser } from '../components/NeedsChooser';
import { FiltersPanel } from '../components/FiltersPanel';
import { Icon } from '../components/Icon';
import { ResourceDetailView } from '../components/ResourceDetail';
import { ResultsList } from '../components/ResultsList';
import { SearchForm } from '../components/SearchForm';
import { ErrorMessage, Loading } from '../components/Status';
import {
  ANY_DISTANCE,
  activeFilterCount,
  buildSearchQuery,
  DEFAULT_FILTERS,
  filtersFromURL,
  mergePreferences,
  filtersToURL,
  RADII,
  REGION_CENTER,
  kmToMiles,
  SORTS,
  type Filters,
} from '../lib/filters';
import { formatAddress } from '../lib/format';
import { toggleNeedPatch } from '../lib/needs';
import { useAsync } from '../lib/useAsync';
import { useMediaQuery } from '../lib/useMediaQuery';
import { useAuth } from '../state/auth';
import { createSelectionStore, useSelection } from '../state/selection';

const MapView = lazy(() => import('../components/MapView'));
export const PAGE_SIZE = 25;
/** Remembers on this device whether the search options above the results are folded away. */
const BAR_KEY = 'nfa_explorer_bar';

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
  // Signed in: saved preferences fill in whatever the URL doesn't choose (once per visit; "Ignore" undoes it).
  const { user } = useAuth();
  const prefsTried = useRef(false);
  const [prefsUndo, setPrefsUndo] = useState<{ before: string; applied: string } | null>(null);
  useEffect(() => {
    if (!user || prefsTried.current) return;
    prefsTried.current = true;
    const cur = new URLSearchParams(spKey);
    const merged = mergePreferences(filtersFromURL(cur), cur, user.preferences);
    const next = filtersToURL(merged);
    if (cur.get('view')) next.set('view', cur.get('view')!);
    if (next.toString() !== cur.toString()) {
      setPrefsUndo({ before: spKey, applied: next.toString() });
      setSp(next, { replace: true });
    }
  }, [user, spKey, setSp]);
  const viewId = Number(sp.get('view')) || null;
  const query = buildSearchQuery(filters, PAGE_SIZE);
  const { data, error, loading, reload } = useAsync((signal) => api.search(query, signal), [query]);
  // The map shows every match (not just this page of the list): a lightweight "pins" request with the same filters.
  const pinsQuery = `${buildSearchQuery({ ...filters, page: 1 }, PAGE_SIZE)}&fields=pins`;
  const pins = useAsync((signal) => api.search(pinsQuery, signal), [pinsQuery]);
  const [nameDraft, setNameDraft] = useState(filters.q);
  useEffect(() => setNameDraft(filters.q), [filters.q]);
  const store = useMemo(() => createSelectionStore(), []);
  const sel = useSelection(store);
  const narrow = useMediaQuery('(max-width: 899px)');
  const [mobileView, setMobileView] = useState<'list' | 'map'>('list');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [barOpen, setBarOpen] = useState(() => {
    // On phones the search options are taller than the screen and would hide the results, so they start folded
    // until the visitor chooses; a saved choice wins everywhere.
    const phone = typeof window !== 'undefined' && !!window.matchMedia?.('(max-width: 899px)').matches;
    try {
      const saved = localStorage.getItem(BAR_KEY);
      return saved === null ? !phone : saved !== '0';
    } catch {
      return !phone;
    }
  });
  const filtersBtnRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLElement>(null);

  // The whole page scrolls. Sticky pieces (desktop map, phone list/map toggle) sit just below the sticky site header,
  // whose height changes with wrapping and zoom, so measure it (and the toggle) into CSS variables.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const header = document.querySelector<HTMLElement>('.site-header');
    const measure = () => {
      root.style.setProperty('--sticky-top', `${header ? Math.round(header.getBoundingClientRect().height) : 0}px`);
      root.style.setProperty('--toggle-h', `${toggleRef.current ? Math.round(toggleRef.current.getBoundingClientRect().height) : 0}px`);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    if (header) ro.observe(header);
    if (toggleRef.current) ro.observe(toggleRef.current);
    return () => ro.disconnect();
  }, [narrow]);

  /** Phone list/map switch. The map view brings the toggle up under the header so the map fills the screen. */
  const showView = useCallback((view: 'list' | 'map') => {
    setMobileView(view);
    const el = toggleRef.current;
    if (el && el.getBoundingClientRect().top > 0) {
      requestAnimationFrame(() => el.scrollIntoView?.({ block: 'start' }));
    }
  }, []);

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
  // Desktop: clicking a map pin opens that place in the left panel (works for every pin, not just this page's cards).
  useEffect(() => {
    if (!narrow && sel.origin === 'map' && sel.id !== null && sel.id !== viewId) open(sel.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel.id, sel.origin, sel.seq, narrow]);
  const toggleBar = () =>
    setBarOpen((open) => {
      try {
        localStorage.setItem(BAR_KEY, open ? '0' : '1');
      } catch {
        /* storage unavailable: the choice just isn't remembered */
      }
      return !open;
    });
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
    if (narrow && sel.origin === 'list' && sel.id !== null) showView('map');
  }, [narrow, sel.id, sel.origin, sel.seq, showView]);

  // Opening a listing in the panel: if the page is scrolled past the top of the list, bring the panel's top into view.
  useEffect(() => {
    const el = listRef.current;
    if (viewId && el && el.getBoundingClientRect().top < 0) el.scrollIntoView?.({ block: 'start' });
  }, [viewId]);

  const jurisdictions = useAsync(() => api.jurisdictions(), []);
  const jurisdictionName = (Array.isArray(jurisdictions.data) ? jurisdictions.data : []).find((j) => j.id === filters.jurisdiction)?.name || filters.jurisdiction;

  const nFilters = activeFilterCount(filters);
  const center = filters.lat !== null && filters.lon !== null ? { lat: filters.lat, lon: filters.lon } : null;
  const selected = data && sel.id !== null ? [...data.items, ...data.uncertain].find((r) => r.id === sel.id) : undefined;
  const placeLabel = filters.bbox ? t('explorer.thisArea') : filters.label || jurisdictionName;
  const mapItems = pins.data?.items || data?.items || [];
  const mapOffset = pins.data ? 1 : data ? (data.page - 1) * data.page_size + 1 : 1;

  return (
    <div ref={rootRef} className={`explorer ${narrow ? `explorer--${mobileView}` : ''}`}>
      <div className={`explorer__bar ${barOpen ? '' : 'is-collapsed'}`}>
        <div className="explorer__head">
          <h1 className="explorer__title">
            {placeLabel ? t('explorer.titleNear', { place: placeLabel }) : t('explorer.title')}
          </h1>
          {/* Folding the search options away leaves the list and map most of the window. */}
          <button type="button" className="btn btn--ghost btn--sm explorer__fold" aria-expanded={barOpen} aria-controls="explorer-search" onClick={toggleBar}>
            <Icon name={barOpen ? 'chevronUp' : 'chevronDown'} />
            {barOpen ? t('explorer.hideSearch') : t('explorer.showSearch')}
          </button>
        </div>
        <div id="explorer-search" className="explorer__search" hidden={!barOpen}>
          <SearchForm compact />
          <AISearch compact />
          <NeedsChooser variant="explorer" filters={filters} onToggle={(need) => update(need ? toggleNeedPatch(filters, need) : { food_groups: [], service_groups: [] })} />
        </div>
        <div className="explorer__controls">
          {barOpen && (
          <>
          <form
            className="field field--inline name-search"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              update({ q: nameDraft.trim() });
            }}
          >
            <label htmlFor="name-q">{t('explorer.nameSearch')}</label>
            {/* One unbreakable row: the box shrinks, but the button never drops underneath it. */}
            <span className="name-search__row">
              <input id="name-q" type="search" value={nameDraft} maxLength={100} placeholder={t('explorer.nameSearchPlaceholder')} onChange={(e) => setNameDraft(e.target.value)} />
              <button type="submit" className="btn btn--secondary btn--sm">{t('explorer.nameSearchGo')}</button>
              {filters.q && (
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => update({ q: '' })}>
                  {t('explorer.nameSearchClear')}
                </button>
              )}
            </span>
          </form>
          <div className="field field--inline">
            <label htmlFor="radius">{t('explorer.radius')}</label>
            <select
              id="radius"
              value={filters.radius_km}
              disabled={!!filters.bbox}
              onChange={(e) => {
                const radius_km = Number(e.target.value);
                // No address yet: measure from the middle of Northern Virginia so the distance still applies.
                update(center ? { radius_km } : { radius_km, lat: REGION_CENTER.lat, lon: REGION_CENTER.lon, label: t('explorer.regionCenter'), sort: 'distance' });
              }}
            >
              {(RADII.includes(filters.radius_km) || filters.radius_km === ANY_DISTANCE ? RADII : [...RADII, filters.radius_km].sort((a, b) => a - b)).map((r) => (
                <option key={r} value={r}>
                  {t('explorer.radiusOption', { miles: kmToMiles(r) })}
                </option>
              ))}
              <option value={ANY_DISTANCE}>{t('explorer.radiusAny')}</option>
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
          </>
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
      </div>

      {narrow && (
        // Its own block (not inside the bar) so it can stay stuck under the header while the page scrolls.
        <div className="explorer__toggle" ref={toggleRef}>
          <div className="viewtoggle" role="group" aria-label={t('explorer.viewToggle')}>
            <button type="button" aria-pressed={mobileView === 'list'} onClick={() => showView('list')}>
              <Icon name="list" />
              {t('explorer.showList')}
            </button>
            <button type="button" aria-pressed={mobileView === 'map'} onClick={() => showView('map')}>
              <Icon name="map" />
              {t('explorer.showMap')}
            </button>
          </div>
        </div>
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

        <section ref={listRef} className="explorer__list" aria-label={t('explorer.resultsLabel')}>
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
              {prefsUndo && prefsUndo.applied === spKey && (
                <p className="prefs-note" role="status">
                  <Icon name="check" size={16} /> {t('explorer.prefsApplied')}{' '}
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => {
                      setSp(new URLSearchParams(prefsUndo.before), { replace: true });
                      setPrefsUndo(null);
                    }}
                  >
                    {t('explorer.prefsIgnore')}
                  </button>{' '}
                  · <Link to="/account">{t('explorer.prefsEdit')}</Link>
                </p>
              )}
              <p className="data-note" data-testid="data-note">
                {t('explorer.dataNote')}{' '}
                <a href="tel:211">{t('explorer.dataNoteCall')}</a>
              </p>
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
              uncertain={pins.data?.uncertain || data?.uncertain || []}
              indexOffset={mapOffset}
              center={center}
              radiusKm={filters.bbox || filters.radius_km === ANY_DISTANCE ? null : filters.radius_km}
              store={store}
              onSearchArea={(bbox) => update({ bbox })}
            />
          </Suspense>
          {narrow && mobileView === 'map' && selected && (
            <div className="peek" role="region" aria-label={selected.name}>
              <p className="peek__name">{selected.name}</p>
              <p className="peek__addr">{formatAddress(selected.address)}</p>
              <div className="peek__actions">
                <Link className="btn btn--primary btn--sm" to={`/resource/${selected.id}`}>
                  {t('card.details')}
                </Link>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => {
                    showView('list');
                    // The list was hidden when the marker was picked; bring the selected card into view now.
                    requestAnimationFrame(() =>
                      document.querySelector(`.explorer__list [data-resource-id="${selected.id}"]`)?.scrollIntoView?.({ block: 'center' }),
                    );
                  }}
                >
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
