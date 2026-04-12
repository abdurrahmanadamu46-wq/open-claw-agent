/**
 * ClawCommerce Content - Anti-detection strategy library
 * Fingerprint (canvas/webgl/audio), User-Agent + proxy rotation, device fingerprint pool.
 * @module content/anti-detection
 */
const DEFAULT_USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
];
/**
 * Resolve config to a concrete User-Agent (for this session).
 */
export function resolveUserAgent(config) {
    const pool = config.userAgentPool?.length ? config.userAgentPool : DEFAULT_USER_AGENTS;
    return pool[Math.floor(Math.random() * pool.length)] ?? DEFAULT_USER_AGENTS[0];
}
/**
 * Get next proxy from pool (round-robin or random).
 */
export function getNextProxy(config, index) {
    const pool = config.proxyPool;
    if (!pool?.length)
        return undefined;
    const i = index ?? Math.floor(Math.random() * pool.length);
    return pool[i % pool.length];
}
/**
 * Select device fingerprint from pool for platform.
 */
export function selectDeviceFingerprint(config, platform) {
    const pool = config.deviceFingerprintPool;
    if (!pool?.length)
        return null;
    const filtered = pool.filter((d) => d.platform === platform);
    const arr = filtered.length ? filtered : pool;
    return arr[Math.floor(Math.random() * arr.length)] ?? null;
}
//# sourceMappingURL=anti-detection.js.map