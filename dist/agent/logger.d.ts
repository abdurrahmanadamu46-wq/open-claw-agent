/**
 * ClawCommerce Agent - Logger interface (Winston-backed)
 * @module agent/logger
 */
export interface Logger {
    info(message: string, meta?: Record<string, unknown>): void;
    warn(message: string, meta?: Record<string, unknown>): void;
    error(message: string, meta?: Record<string, unknown> | Error): void;
    child(meta: Record<string, unknown>): Logger;
}
export declare function createLogger(service?: string): Logger;
/** In-memory logger for tests */
export declare function createMockLogger(): Logger & {
    logs: {
        level: string;
        message: string;
        meta?: unknown;
    }[];
};
//# sourceMappingURL=logger.d.ts.map