import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES, type LangCode } from '../i18n';
import { useAuth } from '../state/auth';
import { Icon } from './Icon';

/** Always-visible language toggle. Each option is written in its own language so people can find theirs. */
export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const { changeLanguage } = useAuth();
  return (
    <div className="lang" role="group" aria-label={t('lang.label')}>
      <Icon name="globe" size={16} />
      {SUPPORTED_LANGUAGES.map((l) => {
        const active = i18n.language === l.code;
        return (
          <button
            key={l.code}
            type="button"
            lang={l.code}
            className={`lang__btn ${active ? 'is-active' : ''}`}
            aria-pressed={active}
            onClick={() => void changeLanguage(l.code as LangCode)}
          >
            {l.native}
          </button>
        );
      })}
    </div>
  );
}
