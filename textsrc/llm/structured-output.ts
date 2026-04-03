/**
 * 强制结构化 JSON 输出工具
 * - 根据 JSON Schema 生成 Prompt 引导文案
 * - 从模型返回中提取并解析 JSON（兼容 markdown 代码块）
 */

const DEFAULT_INSTRUCTION =
  'You must respond with valid JSON only, no other text. No markdown code fence, no explanation.';

/**
 * 根据 schema 生成“必须按此结构输出”的 system 引导
 * 用于不支持 response_format 的 API 或作为双保险
 */
export function buildSchemaInstruction(schema: Record<string, unknown>): string {
  return `${DEFAULT_INSTRUCTION}\nSchema (strict): ${JSON.stringify(schema)}`;
}

/**
 * 从模型返回文本中提取 JSON 并解析
 * 支持：纯 JSON、被 \`\`\`json ... \`\`\` 包裹
 */
export function extractAndParseJson<T = unknown>(raw: string): T {
  let text = raw.trim();
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    text = codeBlockMatch[1].trim();
  }
  const parsed = JSON.parse(text) as T;
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error('Structured output must be a JSON object');
  }
  return parsed;
}

/**
 * 带重试的解析：若第一次解析失败，尝试修正常见问题（如尾部逗号、省略号）
 */
export function extractAndParseJsonWithRetry<T = unknown>(
  raw: string,
  maxAttempts = 2
): T {
  let lastError: Error | null = null;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      let text = raw.trim();
      const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (codeBlockMatch) text = codeBlockMatch[1].trim();
      // 尝试修复常见非法 JSON
      if (i > 0) {
        text = text.replace(/,(\s*[}\]])/g, '$1');
        text = text.replace(/\s*\.{3}\s*$/g, '');
      }
      return JSON.parse(text) as T;
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw lastError ?? new Error('Failed to parse JSON');
}
