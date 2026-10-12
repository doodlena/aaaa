import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES, type LangCode } from '../i18n';
import { useAuth } from '../state/auth';
import { Icon } from './Icon';

const MORE_LANGUAGES = SUPPORTED_LANGUAGES.filter((l) => !l.primary);

/**
 * Always-visible language toggle. Each option is written in its own language so people can find theirs.
 * The most common languages are buttons; the "+" button opens the rest, and a language chosen there joins the row.
 */
export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const { changeLanguage } = useAuth();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      moreBtn.current?.focus();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const choose = (code: LangCode) => {
    setOpen(false);
    void changeLanguage(code);
  };

  const shown = SUPPORTED_LANGUAGES.filter((l) => l.primary || l.code === i18n.language);
  return (
    <div className="lang" role="group" aria-label={t('lang.label')} ref={root}>
      <Icon name="globe" size={16} />
      {shown.map((l) => {
        const active = i18n.language === l.code;
        return (
          <button
            key={l.code}
            type="button"
            lang={l.code}
            className={`lang__btn ${active ? 'is-active' : ''}`}
            aria-pressed={active}
            onClick={() => choose(l.code)}
          >
            {l.native}
          </button>
        );
      })}
      <button
        ref={moreBtn}
        type="button"
        className="lang__btn lang__more"
        aria-label={t('lang.more')}
        title={t('lang.more')}
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="plus" size={16} />
      </button>
      {open && (
        <ul className="lang__menu" id={menuId} aria-label={t('lang.more')}>
          {MORE_LANGUAGES.map((l) => (
            <li key={l.code}>
              <button
                type="button"
                lang={l.code}
                className="lang__option"
                aria-pressed={i18n.language === l.code}
                onClick={() => choose(l.code)}
              >
                {l.native}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
