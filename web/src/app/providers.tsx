'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { CampaignStoreProvider } from '@/contexts/CampaignStore';
import { TenantProvider } from '@/contexts/TenantContext';
import { AlertCenterProvider } from '@/contexts/AlertCenterContext';
import { getCurrentUser } from '@/services/endpoints/user';
import { AnalyticsEvent, identifyUser, initAnalytics, trackEvent, trackPageView } from '@/lib/analytics';

const queryClient = new QueryClient();

function AnalyticsRuntime() {
  const pathname = usePathname();

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
