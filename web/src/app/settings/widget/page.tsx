'use client';

import { useEffect, useMemo, useState } from 'react';
import { Copy, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { fetchWidgetConfig, fetchWidgetScript, updateWidgetConfig } from '@/services/endpoints/ai-subservice';
import { getCurrentUser } from '@/services/endpoints/user';
import type { WidgetConfig } from '@/types/embed-widget';
import { AnalyticsEvent, trackEvent } from '@/lib/analytics';

type LauncherPosition = 'bottom-right' | 'top-right';

function getBrowserOrigin(): string {
  if (typeof window === 'undefined') return 'http://127.0.0.1:3301';
  return window.location.origin;
}

export default function WidgetPage() {
  const t = useTranslations('settings.widget');
  const common = useTranslations('common');
  const [tenantId, setTenantId] = useState('tenant_main');
  const [config, setConfig] = useState<WidgetConfig | null>(null);
  const [allowedDomains, setAllowedDomains] = useState<string[]>([]);
  const [domainInput, setDomainInput] = useState('');
  const [welcomeMessage, setWelcomeMessage] = useState('');
const [themeColor, setThemeColor] = useState('#14b8a6');
const [accentColor, setAccentColor] = useState('#0f172a');
const [customCss, setCustomCss] = useState('');
const [callToAction, setCallToAction] = useState('');
const [launcherPosition, setLauncherPosition] = useState<LauncherPosition>('bottom-right');
  const [scriptPreview, setScriptPreview] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const hydrateForm = (nextConfig: WidgetConfig) => {
    const storedPosition =
      typeof window !== 'undefined'
        ? (window.localStorage.getItem(`widget-position:${nextConfig.tenantId}`) as LauncherPosition | null)
        : null;
    setConfig(nextConfig);
    setAllowedDomains(nextConfig.allowedDomains ?? []);
    setWelcomeMessage(nextConfig.welcomeMessage ?? '');
    setThemeColor(nextConfig.themeColor ?? '#14b8a6');
    setAccentColor(nextConfig.accentColor ?? '#0f172a');
    setCustomCss(nextConfig.customCss ?? '');
    setCallToAction(nextConfig.callToAction ?? '');
    setLauncherPosition(nextConfig.launcherPosition ?? storedPosition ?? 'bottom-right');
  };

  const refreshConfig = async (targetTenant: string) => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchWidgetConfig(targetTenant || tenantId);
      hydrateForm(data.config);
    } catch (err) {
      setError(String((err as Error).message || t('messages.requestFailed')));
    } finally {
      setLoading(false);
    }
  };

  const refreshScript = async (widgetId?: string) => {
    if (!widgetId) return;
    setError('');
    try {
      const data = await fetchWidgetScript(widgetId);
      setScriptPreview(data.script?.script ?? '');
    } catch (err) {
      setError(String((err as Error).message || t('messages.requestFailed')));
    }
  };

  useEffect(() => {
    void getCurrentUser()
      .then((me) => {
        const nextTenantId = me?.tenantId || 'tenant_main';
        setTenantId(nextTenantId);
        return refreshConfig(nextTenantId);
      })
      .catch(() => refreshConfig('tenant_main'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!config?.widgetId) return;
    void refreshScript(config.widgetId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.widgetId]);

  const handleAddDomain = () => {
    const domain = domainInput.trim();
    if (!domain) return;
    setAllowedDomains((prev) => Array.from(new Set([...prev, domain])));
    setDomainInput('');
  };

  const handleRemoveDomain = (domain: string) => {
    setAllowedDomains((prev) => prev.filter((item) => item !== domain));
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const data = await updateWidgetConfig({
        tenant_id: tenantId,
        allowed_domains: allowedDomains,
        welcome_message: welcomeMessage.trim(),
        theme_color: themeColor,
        accent_color: accentColor,
        custom_css: customCss.trim(),
        call_to_action: callToAction.trim(),
        launcher_position: launcherPosition,
      });
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(`widget-position:${tenantId}`, launcherPosition);
      }
      hydrateForm(data.config);
      setMessage(t('messages.saved'));
      if (data.config.widgetId) {
        await refreshScript(data.config.widgetId);
      }
    } catch (err) {
      setError(String((err as Error).message || t('messages.requestFailed')));
    } finally {
      setSaving(false);
    }
  };

  const previewDomains = useMemo(
    () => (allowedDomains.length > 0 ? allowedDomains : [t('placeholders.noDomains')]),
    [allowedDomains, t],
  );

  const embedCode = useMemo(() => {
    if (!config?.widgetId) return '';
    const origin = getBrowserOrigin();
    return `<script async src="${origin}/api/v1/widget/script/${config.widgetId}" data-tenant="${tenantId}" data-position="${launcherPosition}"></script>`;
  }, [config?.widgetId, tenantId, launcherPosition]);

  const previewSrcDoc = useMemo(() => {
    if (!config?.widgetId) return '<!doctype html><html><body style="background:#0f172a;color:#cbd5e1;font-family:system-ui;padding:24px;">Widget 预览将在保存配置后显示。</body></html>';
    const scriptSrc = `${getBrowserOrigin()}/api/v1/widget/script/${config.widgetId}`;
    const pinTop = launcherPosition === 'top-right';
    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html,body{margin:0;height:100%;background:#0b1220;color:#cbd5e1;font-family:system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;}
      .stage{height:100%;position:relative;background:radial-gradient(circle at top left, rgba(20,184,166,0.12), transparent 28%), #0b1220;}
      .chrome{padding:16px 20px;color:#94a3b8;font-size:12px;letter-spacing:.08em;text-transform:uppercase;}
    </style>
  </head>
  <body>
    <div class="stage">
      <div class="chrome">Widget Preview</div>
    </div>
    <script>
      const targetTop = ${pinTop ? "'20px'" : "null"};
      const targetBottom = ${pinTop ? "null" : "'20px'"};
      const reposition = () => {
        const candidate = [...document.body.children].find((node) => node instanceof HTMLElement && node.style.zIndex === '2147483000');
        if (!candidate) return;
        candidate.style.right = '20px';
        candidate.style.left = 'auto';
        if (targetTop) {
          candidate.style.top = targetTop;
          candidate.style.bottom = 'auto';
        }
        if (targetBottom) {
          candidate.style.bottom = targetBottom;
          candidate.style.top = 'auto';
        }
      };
      const observer = new MutationObserver(reposition);
      observer.observe(document.body, { childList: true, subtree: true });
      window.addEventListener('load', reposition);
    </script>
    <script async src="${scriptSrc}"></script>
  </body>
</html>`;
  }, [config?.widgetId, launcherPosition]);

  const handleCopy = async () => {
    if (!embedCode) return;
    try {
      await navigator.clipboard.writeText(embedCode);
      setMessage(t('messages.copied'));
      trackEvent(AnalyticsEvent.WIDGET_SCRIPT_COPIED, {
        tenant_id: tenantId,
        widget_id: config?.widgetId,
      });
    } catch (err) {
      setError(String((err as Error).message || '复制失败'));
    }
  };

  return (
    <div className="min-h-[calc(100vh-5rem)] bg-[#050d16] px-6 py-6 text-slate-100">
      <div className="mx-auto grid max-w-5xl gap-6 rounded-[28px] border border-white/10 bg-[#0b1628] p-6 shadow-2xl">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-cyan-300">{t('badge')}</p>
            <h1 className="mt-2 text-3xl font-semibold text-white">{t('title')}</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-400">{t('description')}</p>
          </div>
          <button
            type="button"
            onClick={() => void refreshScript(config?.widgetId)}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-700/80 px-4 py-2 text-sm text-slate-200 hover:border-cyan-400/80"
          >
            <RefreshCw className="h-4 w-4" />
            {t('buttons.refresh')}
          </button>
        </header>

        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <section className="space-y-4 rounded-3xl border border-white/10 bg-[#0f172a]/70 p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">{t('sections.domains')}</h2>
              <span className="text-xs text-slate-400">{allowedDomains.length} {t('sections.count')}</span>
            </div>

            <div className="flex gap-2">
              <input
                value={domainInput}
                onChange={(event) => setDomainInput(event.target.value)}
                placeholder="example.com"
                className="flex-1 rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-white"
              />
              <button
                type="button"
                onClick={handleAddDomain}
                className="rounded-2xl border border-cyan-500/60 bg-cyan-500/10 px-4 py-2 text-sm text-cyan-100"
              >
                {t('buttons.add')}
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              {previewDomains.map((domain) => (
                <span key={domain} className="flex items-center gap-2 rounded-2xl border border-slate-700/60 bg-slate-950/40 px-3 py-1 text-sm">
                  <span className="text-slate-300">{domain}</span>
                  {allowedDomains.includes(domain) ? (
                    <button type="button" onClick={() => handleRemoveDomain(domain)} className="text-xs text-slate-400">
                      x
                    </button>
                  ) : null}
                </span>
              ))}
            </div>

            <label className="text-xs uppercase tracking-[0.3em] text-slate-400">
              {t('fields.welcomeMessage')}
              <textarea
                value={welcomeMessage}
                onChange={(event) => setWelcomeMessage(event.target.value)}
                rows={2}
                className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-white"
                placeholder={t('placeholders.welcome')}
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-xs uppercase tracking-[0.3em] text-slate-400">
                {t('fields.themeColor')}
                <input
                  type="color"
                  value={themeColor}
                  onChange={(event) => setThemeColor(event.target.value)}
                  className="mt-2 h-11 w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-2 py-2"
                />
              </label>
              <label className="text-xs uppercase tracking-[0.3em] text-slate-400">
                {t('fields.accentColor')}
                <input
                  type="color"
                  value={accentColor}
                  onChange={(event) => setAccentColor(event.target.value)}
                  className="mt-2 h-11 w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-2 py-2"
                />
              </label>
            </div>

            <label className="text-xs uppercase tracking-[0.3em] text-slate-400">
              {t('fields.callToAction')}
              <input
                value={callToAction}
                onChange={(event) => setCallToAction(event.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-white"
                placeholder={t('placeholders.callToAction')}
              />
            </label>

            <label className="text-xs uppercase tracking-[0.3em] text-slate-400">
              {t('fields.launcherPosition')}
              <select
                value={launcherPosition}
                onChange={(event) => {
                  const nextPosition = event.target.value as LauncherPosition;
                  setLauncherPosition(nextPosition);
                  trackEvent(AnalyticsEvent.WIDGET_POSITION_CHANGED, {
                    tenant_id: tenantId,
                    widget_id: config?.widgetId,
                    launcher_position: nextPosition,
                  });
                }}
                className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-white"
              >
                <option value="bottom-right">右下</option>
                <option value="top-right">右上</option>
              </select>
            </label>

            <div className="rounded-2xl border border-dashed border-slate-700/60 bg-slate-950/30 px-4 py-3 text-xs text-slate-400">
              {t('messages.positionHint')}
            </div>

            <label className="text-xs uppercase tracking-[0.3em] text-slate-400">
              {t('fields.customCss')}
              <textarea
                value={customCss}
                onChange={(event) => setCustomCss(event.target.value)}
                rows={4}
                className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm font-mono text-white"
                placeholder={t('placeholders.customCss')}
              />
            </label>

            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving || loading}
              className="w-full rounded-2xl border border-cyan-400/40 bg-cyan-400/10 px-4 py-2 text-sm font-semibold text-cyan-100 disabled:opacity-60"
            >
              {saving ? t('buttons.saving') : common('save')}
            </button>

            {message ? <div className="text-sm text-emerald-300">{message}</div> : null}
            {error ? <div className="text-sm text-rose-300">{error}</div> : null}
          </section>

          <section className="space-y-6 rounded-3xl border border-white/10 bg-[#0f172a]/80 p-6">
            <div>
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">{t('sections.script')}</h2>
                <span className="text-xs text-slate-400">{config?.widgetId || t('placeholders.script')}</span>
              </div>
              <div className="mt-4 rounded-2xl border border-dashed border-slate-700/60 bg-black/40 p-4">
                <textarea
                  value={embedCode}
                  readOnly
                  rows={5}
                  className="w-full rounded-2xl border border-white/5 bg-black/30 px-3 py-2 text-xs font-mono text-cyan-100"
                />
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => void handleCopy()}
                  className="inline-flex items-center gap-2 rounded-2xl border border-cyan-500/60 bg-cyan-500/10 px-4 py-2 text-sm text-cyan-100"
                >
                  <Copy className="h-4 w-4" />
                  {t('buttons.copy')}
                </button>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">{t('sections.preview')}</h2>
                <button
                  type="button"
                  onClick={() =>
                    trackEvent(AnalyticsEvent.WIDGET_PREVIEW_OPENED, {
                      tenant_id: tenantId,
                      widget_id: config?.widgetId,
                    })
                  }
                  className="text-xs text-slate-400"
                >
                  {t('buttons.trackPreview')}
                </button>
              </div>
              <div className="mt-4 overflow-hidden rounded-2xl border border-dashed border-slate-700/60 bg-black/40">
                <iframe
                  title="widget-preview"
                  srcDoc={previewSrcDoc}
                  className="h-[480px] w-full bg-[#0b1220]"
                  sandbox="allow-scripts allow-same-origin allow-forms"
                />
              </div>
            </div>

            <div>
              <div className="text-sm font-medium text-white">{t('sections.scriptSource')}</div>
              <div className="mt-4 rounded-2xl border border-dashed border-slate-700/60 bg-black/40 p-4">
                <textarea
                  value={scriptPreview}
                  readOnly
                  rows={10}
                  className="w-full rounded-2xl border border-white/5 bg-black/30 px-3 py-2 text-xs font-mono text-cyan-100"
                />
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
