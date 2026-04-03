import { Logger } from '@nestjs/common';
import { redactText } from './redaction';

export class RedisWriteBlockedError extends Error {
  constructor(message: string, public readonly causeError?: unknown) {
    super(message);
    this.name = 'RedisWriteBlockedError';
  }
}

export async function redisReadWithFallback<T>(
  logger: Logger,
  context: string,
  op: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await op();
  } catch (err) {
    const safeMessage = redactText(err instanceof Error ? err.message : String(err));
    logger.warn(`[RedisReadDegraded] ${context}: ${safeMessage}`);
    return fallback;
  }
}

export async function redisWriteOrBlock<T>(
  logger: Logger,
  context: string,
  op: () => Promise<T>,
): Promise<T> {
  try {
    return await op();
  } catch (err) {
    const safeMessage = redactText(err instanceof Error ? err.message : String(err));
    logger.error(`[RedisWriteBlocked] ${context}: ${safeMessage}`);
    throw new RedisWriteBlockedError(`Redis write blocked in ${context}`, err);
  }
}
