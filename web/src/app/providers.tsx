'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { CampaignStoreProvider } from '@/contexts/CampaignStore';
import { TenantProvider } from '@/contexts/TenantContext';
import { AlertCenterProvider, useAlertCenter } from '@/contexts/AlertCenterContext';
import { getCurrentUser } from '@/services/endpoints/user';
import { AnalyticsEvent, identifyUser, initAnalytics, trackEvent, trackPageView } from '@/lib/analytics';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  },
});

function AnalyticsRuntime() {
  const pathname = usePathname() ?? '';

  useEffect(() => {
    void getCurrentUser()
      .then((user) => {
        initAnalytics(user?.id);
        if (user?.id) {
          identifyUser(user.id, {
            tenant_id: user.tenantId,
            role: user.role,
            is_admin: user.isAdmin,
          });
        }
      })
      .catch(() => initAnalytics());
  }, []);

  useEffect(() => {
    if (!pathname) return;
    trackPageView(pathname);
    trackEvent(AnalyticsEvent.PAGE_VIEWED, { path: pathname });
  }, [pathname]);

  return null;
}

function AlertCenterOverlay() {
  const { xhsCommanderAlerts, dismissXhsCommanderAlert, clearDismissedXhsCommanderAlerts } = useAlertCenter();
  if (!xhsCommanderAlerts.length) return null;
  return (
    <div className="fixed bottom-4 right-4 z-[90] w-[min(360px,calc(100vw-2rem))] space-y-2">
      {xhsCommanderAlerts.slice(0, 3).map((alert) => (
        <div
          key={alert.id}
          className="rounded-2xl border border-amber-300/30 bg-slate-950/95 px-4 py-3 text-sm text-amber-50 shadow-lg"
        >
          <div className="flex items-start justify-between gap-3">
            <a href={alert.href || '/operations/channels/xiaohongshu'} className="min-w-0 flex-1">
              <div className="font-semibold">{alert.title}</div>
              {alert.detail ? <div className="mt-1 text-xs text-amber-100/80">{alert.detail}</div> : null}
            </a>
            <button
              type="button"
              onClick={() => dismissXhsCommanderAlert(alert.id)}
              className="rounded-lg border border-white/10 px-2 py-1 text-[11px] text-amber-50"
            >
              Dismiss
            </button>
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={clearDismissedXhsCommanderAlerts}
        className="rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2 text-xs text-slate-200"
      >
        Restore dismissed XHS alerts
      </button>
    </div>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<{ type: string; message: string } | null>(null);

  useEffect(() => {
    const handler = (e: CustomEvent<{ type: string; message: string; code?: number }>) => {
      setToast({ type: e.detail.type ?? 'error', message: e.detail.message });
      setTimeout(() => setToast(null), 4000);
    };
    window.addEventListener('clawcommerce-toast', handler as EventListener);
    return () => window.removeEventListener('clawcommerce-toast', handler as EventListener);
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem('preferred-locale');
    if (!stored || (stored !== 'zh' && stored !== 'en')) return;
    if (!document.cookie.includes(`NEXT_LOCALE=${stored}`)) {
      document.cookie = `NEXT_LOCALE=${stored}; path=/; max-age=${60 * 60 * 24 * 365}`;
    }
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AnalyticsRuntime />
      <TenantProvider>
        <AlertCenterProvider>
          <CampaignStoreProvider>
            {children}
            <AlertCenterOverlay />
            {toast ? (
              <div
                className={`fixed right-4 top-4 z-[100] rounded-lg px-4 py-3 text-white shadow-lg ${
                  toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'
                }`}
              >
                {toast.message}
              </div>
            ) : null}
          </CampaignStoreProvider>
        </AlertCenterProvider>
      </TenantProvider>
    </QueryClientProvider>
  );
}
