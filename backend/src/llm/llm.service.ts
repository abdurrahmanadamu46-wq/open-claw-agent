/**
 * BYOK 算力中台 — 统一 LLM 调用
 * 请求强制指向 new-api 本地端口，Header 自动带后台生成的 Token
 * 任何 AI Agent 需要调用 OpenAI / DeepSeek 时，通过本 Service 走 new-api
 */

import { Injectable } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';

const NEW_API_BASE = process.env.NEW_API_BASE_URL ?? 'http://localhost:3001';
const NEW_API_TOKEN = process.env.NEW_API_TOKEN ?? '';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionOptions {
  model?: string;
  max_tokens?: number;
  temperature?: number;
}

export interface ChatCompletionResult {
  id: string;
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

@Injectable()
export class LlmService {
  private readonly client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: NEW_API_BASE.replace(/\/$/, '') + '/v1',
      timeout: 120_000,
      headers: {
        'Content-Type': 'application/json',
        ...(NEW_API_TOKEN ? { Authorization: `Bearer ${NEW_API_TOKEN}` } : {}),
      },
    });
  }

  /**
   * OpenAI 兼容的 chat/completions
   * 实际请求发往 new-api，由 new-api 路由到 DeepSeek / OpenAI / 其他上游
   */
  async chat(
    messages: ChatMessage[],
    options: ChatCompletionOptions = {},
  ): Promise<ChatCompletionResult> {
    const { data } = await this.client.post<ChatCompletionResult>('/chat/completions', {
      model: options.model ?? 'gpt-4o-mini',
      messages,
      max_tokens: options.max_tokens ?? 2048,
      temperature: options.temperature ?? 0.7,
    });
    return data;
  }

  /** 获取首条 assistant 回复内容 */
  async chatContent(messages: ChatMessage[], options?: ChatCompletionOptions): Promise<string> {
    const result = await this.chat(messages, options);
    const content = result.choices?.[0]?.message?.content;
    return content ?? '';
  }

  /** 是否已配置 new-api（有 base URL 且可选 token） */
  isConfigured(): boolean {
    return !!NEW_API_BASE;
  }
}
