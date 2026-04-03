/**
 * Grok Adapter — 占位实现，xAI API 兼容 OpenAI 形态时可复用 OpenAI 调用方式
 * 环境变量：XAI_API_KEY 或 GROK_API_KEY，GROK_MODEL（如 grok-2）
 */

import type { LLMProvider, LLMMessage, ChatOptions, StructuredJsonOptions } from '../provider.interface.js';
import { buildSchemaInstruction, extractAndParseJsonWithRetry } from '../structured-output.js';

const DEFAULT_BASE = 'https://api.x.ai/v1';
const DEFAULT_MODEL = 'grok-2';

function getConfig() {
  const apiKey = process.env.XAI_API_KEY ?? process.env.GROK_API_KEY;
  return {
    apiKey,
    baseUrl: (process.env.GROK_BASE_URL ?? DEFAULT_BASE).replace(/\/$/, ''),
    model: process.env.GROK_MODEL ?? DEFAULT_MODEL,
  };
}

async function withRetry<T>(fn: () => Promise<T>, maxAttempts: number = 3): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
  throw lastError;
}

export class GrokAdapter implements LLMProvider {
  readonly name = 'grok';

  private getConfig() {
    const { apiKey } = getConfig();
    if (!apiKey) throw new Error('XAI_API_KEY or GROK_API_KEY is required for Grok adapter');
    return getConfig();
  }

  async chat(messages: LLMMessage[], options?: ChatOptions): Promise<string> {
    const { apiKey, baseUrl, model } = this.getConfig();
    const res = await withRetry(() =>
      fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          temperature: options?.temperature ?? 0.7,
          max_tokens: options?.maxTokens ?? 4096,
        }),
      })
    );
    if (!res.ok) throw new Error(`Grok API ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (content == null) throw new Error('Empty response from Grok');
    return content;
  }

  async structuredJson<T = unknown>(
    messages: LLMMessage[],
    schema: Record<string, unknown>,
    options?: StructuredJsonOptions
  ): Promise<T> {
    const { apiKey, baseUrl, model } = this.getConfig();
    const schemaInstruction = buildSchemaInstruction(schema);
    const enhancedMessages: LLMMessage[] = [
      { role: 'system', content: schemaInstruction },
      ...messages,
    ];
    const res = await withRetry(() =>
      fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: enhancedMessages.map((m) => ({ role: m.role, content: m.content })),
          temperature: options?.temperature ?? 0.3,
          max_tokens: options?.maxTokens ?? 4096,
          response_format: { type: 'json_object' },
        }),
      })
    );
    if (!res.ok) throw new Error(`Grok API ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = data.choices?.[0]?.message?.content;
    if (raw == null) throw new Error('Empty response from Grok');
    return extractAndParseJsonWithRetry<T>(raw);
  }
}
