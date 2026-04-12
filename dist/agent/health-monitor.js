/**
 * ClawCommerce Agent - Health monitor: CDP heartbeat + Playwright state + auto-recovery
 * Runs every 5 minutes (configurable); on anomaly: log, restart container, switch node.
 * @module agent/health-monitor
 */
const CPU_THRESHOLD_PERCENT = 80;
/** PM v1.3：无响应超过 3 分钟自动标记不可用并触发销毁/重启 */
const NO_RESPONSE_THRESHOLD_MS = 3 * 60 * 1000;
export class HealthMonitor {
    nodePool;
    logger;
    intervalMs;
    checkCdp;
    getResourceUsage;
    onUnhealthy;
    timerId = null;
    constructor(options) {
        this.nodePool = options.nodePool;
        this.logger = options.logger;
        this.intervalMs = options.intervalMs ?? 5 * 60 * 1000;
        this.checkCdp = options.checkCdp;
        this.getResourceUsage = options.getResourceUsage ?? (async () => ({}));
        this.onUnhealthy = options.onUnhealthy ?? (async () => { });
    }
    /** Run one full health check pass for all nodes */
    async runPass() {
        const nodes = this.nodePool.getAll();
        const results = [];
        for (const node of nodes) {
            const result = await this.checkOne(node);
            results.push(result);
            await this.applyResult(node.nodeId, result);
        }
        return results;
    }
    async checkOne(node) {
        const checkedAt = new Date().toISOString();
        const nowMs = Date.now();
        let cdpReachable = false;
        let playwrightConnected = false;
        let cpuUsagePercent;
        let memoryUsageMb;
        let message;
        if (node.lastHeartbeatAt) {
            const elapsed = nowMs - new Date(node.lastHeartbeatAt).getTime();
            if (elapsed > NO_RESPONSE_THRESHOLD_MS) {
                return {
                    nodeId: node.nodeId,
                    verdict: 'unhealthy',
                    cdpReachable: false,
                    playwrightConnected: false,
                    cpuUsagePercent,
                    memoryUsageMb,
                    message: `No response for ${Math.round(elapsed / 60000)} min`,
                    checkedAt,
                };
            }
        }
        if (node.cdpEndpoint) {
            try {
                const cdp = await this.checkCdp(node.cdpEndpoint);
                cdpReachable = cdp.ok;
                if (!cdp.ok)
                    message = cdp.message ?? 'CDP unreachable';
            }
            catch (e) {
                message = e instanceof Error ? e.message : String(e);
            }
        }
        else {
            message = 'No CDP endpoint';
        }
        try {
            const usage = await this.getResourceUsage(node.nodeId, node.containerId);
            cpuUsagePercent = usage.cpuPercent;
            memoryUsageMb = usage.memoryMb;
        }
        catch {
            // Non-fatal
        }
        // Playwright state: if we have CDP and it's reachable, assume connected unless we have explicit state
        if (node.playwrightState === 'connected' || (cdpReachable && node.playwrightState !== 'disconnected')) {
            playwrightConnected = true;
        }
        let verdict = 'ok';
        if (!cdpReachable || (cpuUsagePercent != null && cpuUsagePercent > CPU_THRESHOLD_PERCENT)) {
            verdict = 'unhealthy';
            if (cpuUsagePercent != null && cpuUsagePercent > CPU_THRESHOLD_PERCENT) {
                message = `CPU ${cpuUsagePercent}% > ${CPU_THRESHOLD_PERCENT}%`;
            }
        }
        else if (!playwrightConnected || (cpuUsagePercent != null && cpuUsagePercent > 60)) {
            verdict = 'degraded';
        }
        return {
            nodeId: node.nodeId,
            verdict,
            cdpReachable,
            playwrightConnected,
            cpuUsagePercent,
            memoryUsageMb,
            message,
            checkedAt,
        };
    }
    async applyResult(nodeId, result) {
        await this.nodePool.setHealth(nodeId, result.verdict, {
            lastHeartbeatAt: result.checkedAt,
            cpuUsagePercent: result.cpuUsagePercent,
            memoryUsageMb: result.memoryUsageMb,
            playwrightState: result.playwrightConnected ? 'connected' : 'disconnected',
        });
        if (result.verdict === 'unhealthy') {
            this.logger.warn('Node unhealthy', { nodeId, verdict: result.verdict, message: result.message });
            await this.onUnhealthy?.(nodeId, result.message ?? 'Health check failed');
        }
        else if (result.verdict === 'degraded') {
            this.logger.info('Node degraded', { nodeId, verdict: result.verdict });
        }
    }
    /** Start periodic health checks */
    start() {
        if (this.timerId)
            return;
        this.logger.info('Health monitor started', { intervalMs: this.intervalMs });
        const run = () => {
            this.runPass().catch((err) => this.logger.error('Health pass failed', err));
        };
        run();
        this.timerId = setInterval(run, this.intervalMs);
    }
    stop() {
        if (this.timerId) {
            clearInterval(this.timerId);
            this.timerId = null;
        }
        this.logger.info('Health monitor stopped');
    }
}
//# sourceMappingURL=health-monitor.js.map