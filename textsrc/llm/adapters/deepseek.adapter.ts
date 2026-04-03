/**
 * DeepSeek Adapter — OpenAI 兼容 API + JSON mode
 * 环境变量：DEEPSEEK_API_KEY（必填）、可选 DEEPSEEK_BASE_URL、DEEPSEEK_MODEL
 */

import type { LLMProvider, LLMMessage, ChatOptions, StructuredJsonOptions } from '../provider.interface.js';
import {
  buildSchemaInstruction,
  extractAndParseJsonWithRetry,
} from '../structured-output.js';

const DEFAULT_BASE = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-chat';

function getConfig() {
  const apiKey = process.env.DEEPSEEK_API_KEY ?? process.env.OPENAI_API_KEY;
  return {
    apiKey,
    baseUrl: (process.env.DEEPSEEK_BASE_URL ?? DEFAULT_BASE).replace(/\/$/, ''),
    model: process.env.DEEPSEEK_MODEL ?? DEFAULT_MODEL,
  };
}

async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  log?: (msg: string) => void
): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      if (log) log(`Attempt ${attempt}/${maxAttempts} failed: ${lastError.message}`);
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 500 * attempt));
      }
    }
  }
  throw lastError;
}

export class DeepSeekAdapter implements LLMProvider {
  readonly name = 'deepseek';

  private getConfig() {
    const { apiKey } = getConfig();
    if (!apiKey) {
      throw new Error('DEEPSEEK_API_KEY or OPENAI_API_KEY is required for DeepSeek adapter');
    }
    return getConfig();
  }

  async chat(messages: LLMMessage[], options?: ChatOptions): Promise<string> {
    const { apiKey, baseUrl, model } = this.getConfig();
    const body = {
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 4096,
    };

    return withRetry(async () => {
      const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`DeepSeek API ${res.status}: ${errText}`);
      }
      const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const content = data.choices?.[0]?.message?.content;
      if (content == null) throw new Error('Empty response from DeepSeek');
      return content;
    }, 3, (msg) => console.warn('[DeepSeekAdapter]', msg));
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

    const body: Record<string, unknown> = {
      model,
      messages: enhancedMessages.map((m) => ({ role: m.role, content: m.content })),
      temperature: options?.temperature ?? 0.3,
      max_tokens: options?.maxTokens ?? 4096,
      response_format: { type: 'json_object' },
    };

    return withRetry(async () => {
      const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`DeepSeek API ${res.status}: ${errText}`);
      }
      const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const raw = data.choices?.[0]?.message?.content;
      if (raw == null) throw new Error('Empty response from DeepSeek');
      return extractAndParseJsonWithRetry<T>(raw);
    }, 3, (msg) => console.warn('[DeepSeekAdapter]', msg));
  }
}
