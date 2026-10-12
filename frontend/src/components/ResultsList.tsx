import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { SearchResponse } from '../api/types';
import { useSelection, type SelectionStore } from '../state/selection';
import { Icon } from './Icon';
import { ResultCard } from './ResultCard';
import { Empty } from './Status';

interface Props {
  data: SearchResponse;
  store: SelectionStore;
  onOpen?: (id: number) => void;
  onPage?: (page: number) => void;
  onClearFilters?: () => void;
  hasFilters?: boolean;
}

function prefersReducedMotion() {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

export function ResultsList({ data, store, onOpen, onPage, onClearFilters, hasFilters }: Props) {
  const { t } = useTranslation();
  const sel = useSelection(store);
  const refs = useRef(new Map<number, HTMLLIElement>());

  // When the map selects a result, bring its card into view.
  useEffect(() => {
    if (sel.id === null || sel.origin !== 'map') return;
    const el = refs.current.get(sel.id);
    el?.scrollIntoView?.({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }, [sel.id, sel.origin, sel.seq]);

  const setRef = (id: number) => (el: HTMLLIElement | null) => {
    if (el) refs.current.set(id, el);
    else refs.current.delete(id);
  };
  const select = (id: number) => store.select(id, 'list');
  const pages = Math.max(1, Math.ceil(data.total / data.page_size));
  const offset = (data.page - 1) * data.page_size;

  return (
    <div className="results">
      <p className="results__count" role="status" aria-live="polite" aria-atomic="true">
        {t('explorer.resultsCount', { count: data.total })}
        {data.uncertain_total > 0 && <> · {t('explorer.uncertainCount', { count: data.uncertain_total })}</>}
      </p>

      {data.coverage.complete !== true && (
        <p className="notice notice--coverage">
          <Icon name="info" />
          <span>{t('explorer.coverage')}</span>
        </p>
      )}
      {data.truncated && (
        <p className="notice">
          <Icon name="info" />
          <span>{t('explorer.truncated')}</span>
        </p>
      )}

      {data.items.length > 0 ? (
        <ol className="cards" aria-label={t('explorer.confirmedListLabel')}>
          {data.items.map((item, i) => (
            <ResultCard
              key={item.id}
              ref={setRef(item.id)}
              item={item}
              index={offset + i + 1}
              selected={sel.id === item.id}
              onSelect={select}
              onOpen={onOpen}
            />
          ))}
        </ol>
      ) : (
        <Empty title={data.uncertain_total > 0 ? t('explorer.emptyConfirmed') : t('explorer.empty')}>
          <p>{hasFilters ? t('explorer.emptyHintFilters') : t('explorer.emptyHint')}</p>
          {hasFilters && onClearFilters && (
            <button type="button" className="btn btn--secondary" onClick={onClearFilters}>
              {t('filters.clear')}
            </button>
          )}
        </Empty>
      )}

      {pages > 1 && onPage && (
        <nav className="pager" aria-label={t('explorer.pagination')}>
          <button type="button" className="btn btn--secondary" disabled={data.page <= 1} onClick={() => onPage(data.page - 1)}>
            {t('explorer.prev')}
          </button>
          <span>{t('explorer.pageOf', { page: data.page, pages })}</span>
          <button type="button" className="btn btn--secondary" disabled={data.page >= pages} onClick={() => onPage(data.page + 1)}>
            {t('explorer.next')}
          </button>
        </nav>
      )}

      {data.uncertain.length > 0 && (
        <section className="uncertain" aria-labelledby="uncertain-title" data-testid="uncertain-section">
          <h2 id="uncertain-title" className="uncertain__title">
            <Icon name="question" />
            {t('explorer.uncertainTitle')}
          </h2>
          <p className="uncertain__intro">{t('explorer.uncertainIntro')}</p>
          <ul className="cards">
            {data.uncertain.map((item) => (
              <ResultCard key={item.id} ref={setRef(item.id)} item={item} selected={sel.id === item.id} onSelect={select} onOpen={onOpen} uncertain />
            ))}
          </ul>
          {data.uncertain_total > data.uncertain.length && (
            <p className="muted">{t('explorer.uncertainMore', { count: data.uncertain_total - data.uncertain.length })}</p>
          )}
        </section>
      )}
    </div>
  );
}
