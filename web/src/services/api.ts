/**
 * ClawCommerce 前端唯一 HTTP 客户端（Axios 实例）
 * - 统一携带 JWT
 * - 统一错误码映射与全局 Toast 触发
 */

import axios, { type AxiosError } from 'axios';
import { resolvePreviewMockResponse } from './preview-mocks';

function deriveRuntimeApiBaseUrl(): string {
  if (typeof window === 'undefined') return '';
  const { protocol, hostname } = window.location;
  // Local/dev default: backend is usually exposed on 48789.
  if (hostname === '127.0.0.1' || hostname === 'localhost') {
    return `${protocol}//${hostname}:48789`;
  }
  // Reverse-proxy/default same-origin fallback for non-local deployments.
  return `${protocol}//${hostname}`;
}

const BUILD_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL || '').trim();
const BASE_URL = BUILD_BASE_URL || deriveRuntimeApiBaseUrl();

if (typeof window !== 'undefined' && !BASE_URL) {
  throw new Error('NEXT_PUBLIC_API_BASE_URL is required in staging/production');
}

export const api = axios.create({
  baseURL: BASE_URL || undefined,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

const realAdapter = axios.getAdapter(axios.defaults.adapter);

api.defaults.adapter = async (config) => {
  const mocked = await resolvePreviewMockResponse(config);
  if (mocked) return mocked;
  return realAdapter(config);
};

export function triggerErrorToast(message: string, code?: number) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('clawcommerce-toast', { detail: { type: 'error', message, code } }));
  }
}

export function triggerSuccessToast(message: string) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('clawcommerce-toast', { detail: { type: 'success', message } }));
  }
}

const ERROR_BEHAVIOR: Record<number, { message: string; kickLogin?: boolean }> = {
  40001: { message: '参数校验失败' },
  40101: { message: '登录已过期，请重新登录', kickLogin: true },
  40301: { message: '无权限访问该租户数据' },
  50001: { message: '系统繁忙，正在重试' },
};

api.interceptors.request.use((config) => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('clawcommerce_token') : null;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (err: AxiosError<{ code?: number; message?: string }>) => {
    const status = err.response?.status ?? 500;
    const code = err.response?.data?.code;
    const msg = err.response?.data?.message ?? err.message;
    const behavior = code != null ? ERROR_BEHAVIOR[code] : null;

    const retryHint =
      status >= 500
        ? '（请稍后重试）'
        : status === 401
          ? '（请重新登录）'
          : status === 403
            ? '（请检查租户权限）'
            : status === 429
              ? '（请求过于频繁）'
            : '';

    const retryAfter = typeof err.response?.data === 'object' && err.response?.data && 'retryAfter' in err.response.data
      ? Number((err.response.data as { retryAfter?: unknown }).retryAfter)
      : NaN;
    const rateLimitHint = status === 429 && Number.isFinite(retryAfter)
      ? `，请在 ${retryAfter} 秒后重试`
      : '';

    const message = `${behavior?.message ?? msg}${rateLimitHint}${retryHint}`;

    if (status !== 404) {
      triggerErrorToast(message, code ?? status);
    }

    if (behavior?.kickLogin && typeof window !== 'undefined') {
      localStorage.removeItem('clawcommerce_token');
      window.location.href = '/login';
    }

    return Promise.reject(err);
  },
);

export { fetchDashboardMetrics as getDashboardMetrics } from './endpoints/dashboard';
export default api;
