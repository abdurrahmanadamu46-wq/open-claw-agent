/**
 * ClawCommerce Agent - Health monitor: CDP heartbeat + Playwright state + auto-recovery
 * Runs every 5 minutes (configurable); on anomaly: log, restart container, switch node.
 * @module agent/health-monitor
 */
import type { HealthCheckResult } from './types.js';
import type { NodePool } from './node-pool.js';
import type { Logger } from './logger.js';
export interface HealthMonitorOptions {
    nodePool: NodePool;
    logger: Logger;
    /** Interval in ms (default 5 min) */
    intervalMs?: number;
    /** Check CDP reachable (ws endpoint) */
    checkCdp: (cdpEndpoint: string) => Promise<{
        ok: boolean;
        message?: string;
    }>;
    /** Optional: get CPU/memory for node (e.g. from container stats) */
    getResourceUsage?: (nodeId: string, containerId?: string) => Promise<{
        cpuPercent?: number;
        memoryMb?: number;
    }>;
    /** On unhealthy: trigger container restart (e.g. call orchestrator API) */
    onUnhealthy?: (nodeId: string, reason: string) => Promise<void>;
}
export declare class HealthMonitor {
    private nodePool;
    private logger;
    private intervalMs;
    private checkCdp;
    private getResourceUsage;
    private onUnhealthy;
    private timerId;
    constructor(options: HealthMonitorOptions);
    /** Run one full health check pass for all nodes */
    runPass(): Promise<HealthCheckResult[]>;
    private checkOne;
    private applyResult;
    /** Start periodic health checks */
    start(): void;
    stop(): void;
}
//# sourceMappingURL=health-monitor.d.ts.map