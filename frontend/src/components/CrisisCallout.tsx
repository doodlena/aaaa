import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from './Icon';

/**
 * 988 / 911 crisis callout. Shown whenever mental health is the selected need or a listing offers mental-health or
 * crisis services. Deliberately has no close button: it must stay visible in that context.
 */
export function CrisisCallout({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <aside className={`crisis ${compact ? 'crisis--compact' : ''}`} aria-labelledby={`${id}-t`} data-testid="crisis-callout">
      <Icon name="lifebuoy" size={compact ? 22 : 28} className="crisis__icon" />
      <div className="crisis__body">
        <p className="crisis__text">
          <strong id={`${id}-t`}>{t('crisis.title')}</strong> {t('crisis.body')}
        </p>
        <p className="crisis__actions">
          <a className="crisis__btn" href="tel:988">
            <Icon name="phone" size={16} />
            {t('crisis.call988')}
          </a>
          <a className="crisis__btn" href="sms:988">
            <Icon name="message" size={16} />
            {t('crisis.text988')}
          </a>
          <a className="crisis__btn crisis__btn--911" href="tel:911">
            <Icon name="alert" size={16} />
            {t('crisis.call911')}
          </a>
        </p>
      </div>
    </aside>
  );
}
