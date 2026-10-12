import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { DEFAULT_FILTERS, type Filters } from '../lib/filters';
import { NEEDS, needSelected, needURL, type Need } from '../lib/needs';
import { Icon } from './Icon';

/**
 * "What do you need?" — one tile per need. On the home page tiles are links to /find (one need each). In the explorer
 * they are multi-select toggle buttons: each adds or removes its need, and results show places that offer any of them.
 */
export function NeedsChooser(
  props:
    | { variant: 'home'; base?: Filters; headingId?: string }
    | { variant: 'explorer'; filters: Filters; onToggle: (need: Need | null) => void },
) {
  const { t } = useTranslation();
  const id = useId();

  if (props.variant === 'home') {
    const base = props.base ?? DEFAULT_FILTERS;
    return (
      <nav className="needs" aria-labelledby={props.headingId}>
        <ul className="needs__grid">
          {NEEDS.map((n) => (
            <li key={n.id}>
              <Link className={`need need--${n.id}`} to={needURL(n, base)} data-need={n.id}>
                <span className="need__icon">
                  <Icon name={n.icon} size={26} />
                </span>
                <span className="need__label">{t(`needs.${n.id}.label`)}</span>
                <span className="need__hint">{t(`needs.${n.id}.hint`)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    );
  }

  return (
    <div className="needs needs--compact" role="group" aria-labelledby={`${id}-l`}>
      <p id={`${id}-l`} className="needs__label">
        {t('needs.title')} <span className="needs__multi">{t('needs.multiHint')}</span>
      </p>
      <ul className="needs__row">
        <li>
          <button
            type="button"
            className="need-chip"
            aria-pressed={!props.filters.service_groups.length && !props.filters.food_groups.length}
            onClick={() => props.onToggle(null)}
          >
            {t('needs.any')}
          </button>
        </li>
        {NEEDS.map((n) => (
          <li key={n.id}>
            <button
              type="button"
              className="need-chip"
              aria-pressed={needSelected(props.filters, n)}
              data-need={n.id}
              onClick={() => props.onToggle(n)}
            >
              <Icon name={n.icon} size={18} />
              {t(`needs.${n.id}.label`)}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
