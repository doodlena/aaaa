import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from './Icon';

/** Shown while the browser reports no connection. Saved and recently viewed pantries still open from the offline cache. */
export function OfflineBanner() {
  const { t } = useTranslation();
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false);
  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  if (!offline) return null;
  return (
    <div className="offline-banner" role="status">
      <Icon name="wifiOff" size={16} />
      {t('offline.banner')}
    </div>
  );
}
