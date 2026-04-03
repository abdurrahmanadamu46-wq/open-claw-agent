/**
 * ClawCommerce Content - Anti-detection strategy library
 * Fingerprint (canvas/webgl/audio), User-Agent + proxy rotation, device fingerprint pool.
 * @module content/anti-detection
 */

import type { PlatformId } from '../agent/types.js';

export type FingerprintStrategy = 'random' | 'pool' | 'fixed';

export interface AntiDetectionConfig {
  /** Canvas/WebGL/Audio fingerprint: random each run, from pool, or fixed */
  fingerprint: FingerprintStrategy;
  /** User-Agent pool (rotate per session) */
  userAgentPool?: string[];
  /** Proxy list for IP rotation */
  proxyPool?: string[];
  /** Device fingerprint pool (pre-generated) */
  deviceFingerprintPool?: DeviceFingerprint[];
}

/** One device fingerprint entry for pool */
export interface DeviceFingerprint {
  id: string;
  userAgent: string;
  viewport: { width: number; height: number };
  platform: PlatformId;
  /** Optional: canvas/audio hash hints */
  hints?: Record<string, string>;
}

const DEFAULT_USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
];

/**
 * Resolve config to a concrete User-Agent (for this session).
 */
export function resolveUserAgent(config: AntiDetectionConfig): string {
  const pool = config.userAgentPool?.length ? config.userAgentPool : DEFAULT_USER_AGENTS;
  return pool[Math.floor(Math.random() * pool.length)] ?? DEFAULT_USER_AGENTS[0]!;
}

/**
 * Get next proxy from pool (round-robin or random).
 */
export function getNextProxy(config: AntiDetectionConfig, index?: number): string | undefined {
  const pool = config.proxyPool;
  if (!pool?.length) return undefined;
  const i = index ?? Math.floor(Math.random() * pool.length);
  return pool[i % pool.length];
}

/**
 * Select device fingerprint from pool for platform.
 */
export function selectDeviceFingerprint(
  config: AntiDetectionConfig,
  platform: PlatformId
): DeviceFingerprint | null {
  const pool = config.deviceFingerprintPool;
  if (!pool?.length) return null;
  const filtered = pool.filter((d) => d.platform === platform);
  const arr = filtered.length ? filtered : pool;
  return arr[Math.floor(Math.random() * arr.length)] ?? null;
}
