/**
 * ClawCommerce Agent - Logger interface (Winston-backed)
 * @module agent/logger
 */

import winston from 'winston';

export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown> | Error): void;
  child(meta: Record<string, unknown>): Logger;
}

function toWinstonMeta(meta?: Record<string, unknown> | Error): Record<string, unknown> {
  if (!meta) return {};
  if (meta instanceof Error) return { error: meta.message, stack: meta.stack };
  return meta;
}

export function createLogger(service = 'clawcommerce-agent'): Logger {
  const w = winston.createLogger({
    level: process.env.LOG_LEVEL ?? 'info',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    ),
    defaultMeta: { service },
    transports: [new winston.transports.Console()],
  });
  return {
    info: (msg, meta) => w.info(msg, toWinstonMeta(meta)),
    warn: (msg, meta) => w.warn(msg, toWinstonMeta(meta)),
    error: (msg, meta) => w.error(msg, toWinstonMeta(meta)),
    child: (meta) => {
      const childW = w.child(meta as Record<string, unknown>);
      return {
        info: (msg, m) => childW.info(msg, toWinstonMeta(m)),
        warn: (msg, m) => childW.warn(msg, toWinstonMeta(m)),
        error: (msg, m) => childW.error(msg, toWinstonMeta(m)),
        child: (m2) => createLogger(service).child({ ...meta, ...m2 }),
      };
    },
  };
}

/** In-memory logger for tests */
export function createMockLogger(): Logger & { logs: { level: string; message: string; meta?: unknown }[] } {
  const logs: { level: string; message: string; meta?: unknown }[] = [];
  return {
    logs,
    info: (msg, meta) => logs.push({ level: 'info', message: msg, meta }),
    warn: (msg, meta) => logs.push({ level: 'warn', message: msg, meta }),
    error: (msg, meta) => logs.push({ level: 'error', message: msg, meta }),
    child: () => createMockLogger(),
  };
}
