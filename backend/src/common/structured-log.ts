import { Logger } from '@nestjs/common';
import { redactLogRecord } from './redaction';

export type StructuredLogLevel = 'log' | 'warn' | 'error' | 'debug' | 'verbose';

export type StructuredLogRecord = {
  timestamp?: string;
  level?: string;
  service: string;
  eventType: string;
  message: string;
  traceId?: string;
  tenantId?: string;
  campaignId?: string;
  nodeId?: string;
  taskId?: string;
  [key: string]: unknown;
};

function removeUndefined(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v !== undefined) output[k] = v;
  }
  return output;
}

export function emitStructuredLog(
  logger: Logger,
  level: StructuredLogLevel,
  record: StructuredLogRecord,
): void {
  const payload = removeUndefined({
    ...record,
    timestamp: record.timestamp ?? new Date().toISOString(),
    level: record.level ?? level,
    service: record.service,
    eventType: record.eventType,
    message: record.message,
  });
  const line = JSON.stringify(redactLogRecord(payload));
  switch (level) {
    case 'error':
      logger.error(line);
      return;
    case 'warn':
      logger.warn(line);
      return;
    case 'debug':
      logger.debug(line);
      return;
    case 'verbose':
      logger.verbose(line);
      return;
    default:
      logger.log(line);
      return;
  }
}
