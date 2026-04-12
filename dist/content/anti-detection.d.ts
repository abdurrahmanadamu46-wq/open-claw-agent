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
    viewport: {
        width: number;
        height: number;
    };
    platform: PlatformId;
    /** Optional: canvas/audio hash hints */
    hints?: Record<string, string>;
}
/**
 * Resolve config to a concrete User-Agent (for this session).
 */
export declare function resolveUserAgent(config: AntiDetectionConfig): string;
/**
 * Get next proxy from pool (round-robin or random).
 */
export declare function getNextProxy(config: AntiDetectionConfig, index?: number): string | undefined;
/**
 * Select device fingerprint from pool for platform.
 */
export declare function selectDeviceFingerprint(config: AntiDetectionConfig, platform: PlatformId): DeviceFingerprint | null;
//# sourceMappingURL=anti-detection.d.ts.map