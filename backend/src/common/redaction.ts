const SENSITIVE_KEY_PATTERN =
  /(token|api[_-]?key|secret|password|authorization|cookie|phone|mobile|access[_-]?key|secret[_-]?access[_-]?key|signature)/i;

const PHONE_DIGITS_PATTERN = /\b1[3-9]\d{9}\b/g;
const GENERIC_TOKEN_PATTERN =
  /\b([A-Za-z0-9_\-]{12,}\.[A-Za-z0-9_\-]{12,}\.?[A-Za-z0-9_\-]*)\b/g;

function maskTextValue(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return input;
  if (/^\d{11}$/.test(trimmed)) {
    return `${trimmed.slice(0, 3)}****${trimmed.slice(-4)}`;
  }
  if (trimmed.length <= 6) return '***';
  return `${trimmed.slice(0, 3)}***${trimmed.slice(-2)}`;
}

export function redactText(input: string): string {
  if (!input) return input;
  let output = input;
  output = output.replace(
    /\b(Authorization\s*:\s*Bearer\s+)([^\s,;]+)/gi,
    (_m, p1) => `${p1}[REDACTED]`,
  );
  output = output.replace(
    /\b((?:api[_-]?key|token|secret|password|authorization|cookie|signature)\s*[:=]\s*)([^\s,;]+)/gi,
    (_m, p1) => `${p1}[REDACTED]`,
  );
  output = output.replace(PHONE_DIGITS_PATTERN, (m) => `${m.slice(0, 3)}****${m.slice(-4)}`);
  output = output.replace(GENERIC_TOKEN_PATTERN, '[REDACTED_TOKEN]');
  return output;
}

function redactUnknownValue(value: unknown, depth: number): unknown {
  if (depth > 6) return '[REDACTED_DEPTH_LIMIT]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactText(value);
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redactUnknownValue(v, depth + 1));

  const output: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      if (typeof val === 'string') {
        output[key] = maskTextValue(val);
      } else {
        output[key] = '[REDACTED]';
      }
      continue;
    }
    output[key] = redactUnknownValue(val, depth + 1);
  }
  return output;
}

export function redactLogRecord<T>(input: T): T {
  return redactUnknownValue(input, 0) as T;
}

