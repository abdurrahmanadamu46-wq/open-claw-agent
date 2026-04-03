/**
 * Demo mode policy:
 * - enabled only by explicit switch, never by missing API base url
 * - staging/prod should fail fast when API base is missing
 */
export function isDemoMode(): boolean {
  if (typeof window === 'undefined') return false;
  const env = (process.env.NEXT_PUBLIC_RUNTIME_ENV ?? process.env.NODE_ENV ?? 'development').toLowerCase();
  const allowInProd = process.env.NEXT_PUBLIC_ALLOW_DEMO_MODE === 'true';
  if ((env === 'production' || env === 'staging') && !allowInProd) {
    return false;
  }
  if (process.env.NEXT_PUBLIC_USE_MOCK === 'true') return true;
  try {
    if (localStorage.getItem('clawcommerce_demo_mode') === '1') return true;
  } catch {
    /* ignore */
  }
  return false;
}

export function shouldFailFastForMissingApiBase(): boolean {
  const env = (process.env.NEXT_PUBLIC_RUNTIME_ENV ?? process.env.NODE_ENV ?? 'development').toLowerCase();
  return env === 'production' || env === 'staging';
}

export function allowDashboardMockFallback(): boolean {
  return process.env.NEXT_PUBLIC_DASHBOARD_ALLOW_MOCK_FALLBACK === 'true';
}
