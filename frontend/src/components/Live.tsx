import { useTranslation } from 'react-i18next';
import type { LiveShelf, LiveStatus, ShelfItem, ShelfLevel } from '../api/types';
import { formatDateTime, timeAgo } from '../lib/format';
import { Icon } from './Icon';

/**
 * Live shelf status, as posted by the pantry. Rule: every state is a distinct SHAPE + TEXT, colour only reinforces.
 *   open    = filled circle with a check
 *   limited = half-filled circle
 *   out     = empty circle with a slash
 *   closed  = square with a cross
 */
export function StatusGlyph({ status, size = 16 }: { status: LiveStatus; size?: number }) {
  return (
    <svg className={`sglyph sglyph--${status}`} width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {status === 'open' && (
        <>
          <circle cx="8" cy="8" r="7" fill="currentColor" />
          <path d="M4.6 8.3l2.3 2.3 4.5-4.8" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      {status === 'limited' && (
        <>
          <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path d="M8 1.8a6.2 6.2 0 0 1 0 12.4z" fill="currentColor" />
        </>
      )}
      {status === 'out' && (
        <>
          <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path d="M3.8 12.2l8.4-8.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </>
      )}
      {status === 'closed' && (
        <>
          <rect x="1.5" y="1.5" width="13" height="13" rx="2" fill="currentColor" />
          <path d="M5 5l6 6M11 5l-6 6" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

export function LiveStatusTag({ status, large = false }: { status: LiveStatus; large?: boolean }) {
  const { t } = useTranslation();
  return (
    <span className={`lstatus lstatus--${status} ${large ? 'lstatus--lg' : ''}`} data-live-status={status}>
      <StatusGlyph status={status} size={large ? 20 : 16} />
      <span>{t(`live.status.${status}`)}</span>
    </span>
  );
}

const BARS: Record<ShelfLevel, number> = { plenty: 3, some: 2, low: 1 };

/** Three-bar meter (decorative) + the level as a word (the real information). */
export function LevelMeter({ level }: { level: ShelfLevel }) {
  const { t } = useTranslation();
  const n = BARS[level] ?? 0;
  return (
    <span className={`level level--${level}`}>
      <span className="level__bars" aria-hidden="true">
        {[1, 2, 3].map((i) => (
          <span key={i} className={i <= n ? 'is-on' : ''} />
        ))}
      </span>
      <span className="level__text">{t(`live.level.${level}`)}</span>
    </span>
  );
}

/** Items on the shelf today, as hanging shelf-talker tags: food name + level (bars + word). */
export function ShelfTags({ items, label, compact = false }: { items: ShelfItem[]; label?: string; compact?: boolean }) {
  const { t } = useTranslation();
  if (!items.length) return null;
  return (
    <ul className={`shelf ${compact ? 'shelf--compact' : ''}`} aria-label={label ?? t('live.itemsLabel')}>
      {items.map((i) => (
        <li key={i.food_type} className="shelf__tag" data-level={i.level}>
          <span className="shelf__food">{t(`foodType.${i.food_type}`, { defaultValue: i.food_type })}</span>
          <LevelMeter level={i.level} />
        </li>
      ))}
    </ul>
  );
}

/** "Posted by the pantry · 2 h ago" (+ AI-assisted note). The source is always named, never implied. */
export function PostedBy({ live, showExpiry = false }: { live: LiveShelf; showExpiry?: boolean }) {
  const { t, i18n } = useTranslation();
  return (
    <p className="posted" data-testid="posted-by">
      <span className="posted__who">
        <Icon name="store" size={15} />
        {t('live.postedByPantry')}
      </span>
      <span className="posted__sep" aria-hidden="true">
        ·
      </span>
      <time dateTime={live.posted_at} title={formatDateTime(live.posted_at, i18n.language)}>
        {timeAgo(live.posted_at, t)}
      </time>
      {showExpiry && (
        <>
          <span className="posted__sep" aria-hidden="true">
            ·
          </span>
          <span>{t('live.until', { time: formatDateTime(live.expires_at, i18n.language) })}</span>
        </>
      )}
      {live.ai_assisted && <span className="posted__ai">{t('live.aiAssisted')}</span>}
    </p>
  );
}

/** Compact live block for result cards and the home feed. */
export function LiveSummary({ live, compact = true }: { live: LiveShelf; compact?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className={`live live--${live.status}`} data-testid="live-summary">
      <div className="live__head">
        <LiveStatusTag status={live.status} />
        <PostedBy live={live} />
      </div>
      {live.message && <p className="live__msg">“{live.message}”</p>}
      <ShelfTags items={live.items} compact={compact} label={t('live.itemsLabel')} />
    </div>
  );
}

export function ReportsNotice({ count }: { count?: number }) {
  const { t } = useTranslation();
  if (!count) return null;
  return (
    <p className="reports-notice">
      <Icon name="flag" size={15} />
      {t('reports.recent', { count })}
    </p>
  );
}
