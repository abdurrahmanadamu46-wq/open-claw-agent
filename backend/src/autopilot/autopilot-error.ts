export interface AutopilotErrorClassification {
  code: string;
  retryable: boolean;
}

const NON_RETRYABLE_PATTERNS: Array<{ code: string; pattern: RegExp }> = [
  { code: 'DAILY_LIMIT_EXCEEDED', pattern: /daily limit exceeded|每日生成上限|上限已用完/i },
  { code: 'MISSING_API_KEY', pattern: /api key.*not configured|api key.*missing|未配置/i },
  { code: 'VALIDATION_ERROR', pattern: /invalid|validation/i },
];

export function classifyAutopilotError(err: unknown): AutopilotErrorClassification {
  if (err instanceof Error && err.name === 'RedisWriteBlockedError') {
    return { code: 'REDIS_WRITE_BLOCKED', retryable: true };
  }
  const message = err instanceof Error ? err.message : String(err);
  for (const rule of NON_RETRYABLE_PATTERNS) {
    if (rule.pattern.test(message)) {
      return { code: rule.code, retryable: false };
    }
  }
  return { code: 'UNKNOWN_RETRYABLE', retryable: true };
}
