/**
 * OpenAI Adapter — 官方 API + JSON mode
 * 环境变量：OPENAI_API_KEY，可选 OPENAI_MODEL（默认 gpt-4o）
 */

import type { LLMProvider, LLMMessage, ChatOptions, StructuredJsonOptions } from '../provider.interface.js';
import {
  buildSchemaInstruction,
  extractAndParseJsonWithRetry,
} from '../structured-output.js';

const DEFAULT_BASE = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o';

function getConfig() {
  const apiKey = process.env.OPENAI_API_KEY;
  return {
    apiKey,
    baseUrl: (process.env.OPENAI_BASE_URL ?? DEFAULT_BASE).replace(/\/$/, ''),
    model: process.env.OPENAI_MODEL ?? DEFAULT_MODEL,
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

export class OpenAIAdapter implements LLMProvider {
  readonly name = 'openai';

  private getConfig() {
    const { apiKey } = getConfig();
    if (!apiKey) throw new Error('OPENAI_API_KEY is required for OpenAI adapter');
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
    if (!res.ok) throw new Error(`OpenAI API ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (content == null) throw new Error('Empty response from OpenAI');
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
    if (!res.ok) throw new Error(`OpenAI API ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = data.choices?.[0]?.message?.content;
    if (raw == null) throw new Error('Empty response from OpenAI');
    return extractAndParseJsonWithRetry<T>(raw);
  }
}
