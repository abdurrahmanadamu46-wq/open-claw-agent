/**
 * Mock Adapter — 无 API 调用，用于单测与本地开发
 * 环境变量：LLM_PROVIDER=mock 时使用
 */

import type { LLMProvider, LLMMessage, ChatOptions, StructuredJsonOptions } from '../provider.interface.js';

export interface MockLLMConfig {
  /** chat() 固定返回 */
  chatResponse?: string;
  /** structuredJson() 固定返回（会直接返回，不解析） */
  structuredResponse?: unknown;
}

const defaultConfig: MockLLMConfig = {
  chatResponse: 'Mock response',
  structuredResponse: {
    hook: '前3秒钩子',
    painPoints: ['痛点1', '痛点2'],
    sellingPoints: ['卖点1', '卖点2'],
  },
};

export class MockAdapter implements LLMProvider {
  readonly name = 'mock';
  private config: MockLLMConfig;

  constructor(config: MockLLMConfig = {}) {
    this.config = { ...defaultConfig, ...config };
  }

  async chat(_messages: LLMMessage[], _options?: ChatOptions): Promise<string> {
    return this.config.chatResponse ?? defaultConfig.chatResponse!;
  }

  async structuredJson<T = unknown>(
    _messages: LLMMessage[],
    schema: Record<string, unknown>,
    _options?: StructuredJsonOptions
  ): Promise<T> {
    const props = schema?.properties as Record<string, unknown> | undefined;
    if (props && 'scenes' in props) {
      return getDefaultScriptResponse() as T;
    }
    if (this.config.structuredResponse !== undefined) {
      return this.config.structuredResponse as T;
    }
    return defaultConfig.structuredResponse as T;
  }
}

/** 剧本生成 Mock 返回（供 content-factory 单测） */
function getDefaultScriptResponse(): { scenes: { text: string; durationSeconds?: number }[]; totalDurationSeconds: number } {
  return {
    scenes: [
      { text: '前3秒钩子：这款真的绝了', durationSeconds: 3 },
      { text: '痛点：敏感肌不敢乱用', durationSeconds: 2 },
      { text: '卖点：成分安全，24小时持妆', durationSeconds: 2 },
      { text: '卖点：性价比高', durationSeconds: 2 },
      { text: '行动号召：链接在评论区', durationSeconds: 1 },
    ],
    totalDurationSeconds: 10,
  };
}
