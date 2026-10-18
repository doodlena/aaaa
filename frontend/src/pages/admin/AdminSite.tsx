import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import type { SiteSettings } from '../../api/types';
import { ErrorMessage, Loading } from '../../components/Status';
import { useAsync } from '../../lib/useAsync';
import { useMeta } from '../../state/meta';
import { adminError } from './shared';

type Key = 'demo_mode' | 'provider_features' | 'district_only';
const KEYS: Key[] = ['demo_mode', 'provider_features', 'district_only'];

/**
 * /admin/site — switches: demo mode (fictional providers for videos; this browser only, via a cookie), and the
 * site-wide live provider features and "only Virginia's 8th district". Nothing is deleted by any switch; listings are
 * only hidden or shown. After every change the public meta is re-fetched so filters and feed update without a reload.
 */
export function AdminSite() {
  const { t } = useTranslation();
  const { refreshFeatures } = useMeta();
  const loaded = useAsync(() => api.admin.siteSettings(), []);
  const [s, setS] = useState<SiteSettings | null>(null);
  const [busy, setBusy] = useState<Key | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (loaded.data) setS(loaded.data);
  }, [loaded.data]);

  const flip = async (key: Key, on: boolean) => {
    setBusy(key);
    setMsg(null);
    try {
      setS(await api.admin.patchSiteSettings({ [key]: on }));
      await refreshFeatures();
      setMsg({ ok: true, text: t(`admin.site.${key}.${on ? 'turnedOn' : 'turnedOff'}`) });
    } catch (e) {
      setMsg({ ok: false, text: adminError(e, t) });
    } finally {
      setBusy(null);
    }
  };

  if (loaded.loading && !s) return <Loading />;
  if (loaded.error && !s) return <ErrorMessage error={loaded.error} onRetry={loaded.reload} />;
  if (!s) return null;

  return (
    <div className="site-admin">
      <h1>{t('admin.site.title')}</h1>
      <p className="lead">{t('admin.site.lead')}</p>
      <div role="status" aria-live="polite" className="ai-admin__msg">
        {msg && <p className={msg.ok ? 'form-ok' : 'form-error'}>{msg.text}</p>}
      </div>
      {KEYS.map((key) => {
        const forced = key === 'provider_features' && s.demo_mode;
        const on = forced ? true : s[key];
        return (
          <section key={key} className={`site-switch ${on ? 'is-on' : ''}`} aria-labelledby={`site-${key}`}>
            <label className="check switch site-switch__row">
              <input
                type="checkbox"
                role="switch"
                checked={on}
                disabled={busy !== null || forced}
                onChange={(e) => void flip(key, e.target.checked)}
                aria-labelledby={`site-${key}`}
                aria-describedby={`site-${key}-help`}
                data-testid={`site-${key}`}
              />
              <span id={`site-${key}`} className="site-switch__label">
                {t(`admin.site.${key}.label`)}
              </span>
              <span className="site-switch__state" aria-hidden="true">{busy === key ? t('admin.site.saving') : on ? t('admin.site.on') : t('admin.site.off')}</span>
            </label>
            <p className="fgroup__hint" id={`site-${key}-help`}>
              {t(`admin.site.${key}.help`)}
              {forced && <> {t('admin.site.provider_features.forced')}</>}
              {key === 'demo_mode' && s.demo_listings > 0 && <> {t('admin.site.demo_mode.loaded', { count: s.demo_listings })}</>}
            </p>
          </section>
        );
      })}
    </div>
  );
}
