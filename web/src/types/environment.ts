/**
 * 浏览器隔离环境 (Sandbox Environment) — 矩阵账号与防封核心实体
 * 物理龙虾（电脑）与账号环境（指纹）解耦：环境 = 网络 + 指纹 + Cookie 登机牌
 */

export type EnvironmentPlatform = 'xiaohongshu' | 'douyin' | 'wechat';

export type FingerprintEngine = 'standard' | 'kameleo';

export type AccountAuthStatus = 'authorized' | 'need_scan';

export interface BrowserEnvironment {
  id: string;
  name: string;
  platform: EnvironmentPlatform;
  /** 代理地址（存完整，展示脱敏） */
  proxyUrl: string | null;
  proxyEnabled: boolean;
  fingerprintEngine: FingerprintEngine;
  /** 高级指纹：系统 */
  fingerprintOs?: 'win' | 'mac';
  /** 高级指纹：浏览器 */
  fingerprintBrowser?: 'chrome' | 'edge';
  accountStatus: AccountAuthStatus;
  updatedAt: string;
}

export const ENVIRONMENT_PLATFORM_LABELS: Record<EnvironmentPlatform, string> = {
  xiaohongshu: '小红书',
  douyin: '抖音',
  wechat: '微信',
};

export const FINGERPRINT_ENGINE_LABELS: Record<FingerprintEngine, string> = {
  standard: '标准指纹',
  kameleo: 'Kameleo 高级指纹',
};

/** 脱敏显示代理 IP，例如 103.45.67.89 -> 103.45.*.* */
export function maskProxyUrl(url: string | null): string {
  if (!url || !url.trim()) return '—';
  try {
    const u = url.replace(/^[^@]+@/, ''); // 去掉 user:pass@
    const hostMatch = u.match(/(?:\[([^\]]+)\]|([^:\/]+))[:/]/);
    const host = hostMatch ? (hostMatch[1] || hostMatch[2] || '').trim() : '';
    const parts = host.split('.');
    if (parts.length >= 4) {
      return `${parts[0]}.${parts[1]}.*.*`;
    }
    if (parts.length >= 2) return `${parts[0]}.${parts[1]}.*`;
    return host || '—';
  } catch {
    return '—';
  }
}
