/**
 * LLM Adapter 工厂 — 根据 env 一行配置切换模型
 * LLM_PROVIDER=deepseek | openai | grok | mock
 */

import type { LLMProvider } from '../provider.interface.js';
import { DeepSeekAdapter } from './deepseek.adapter.js';
import { OpenAIAdapter } from './openai.adapter.js';
import { GrokAdapter } from './grok.adapter.js';
import { MockAdapter } from './mock.adapter.js';

let defaultProvider: LLMProvider | null = null;

function createProvider(): LLMProvider {
  const provider = (process.env.LLM_PROVIDER ?? 'deepseek').toLowerCase();
  switch (provider) {
    case 'deepseek':
      return new DeepSeekAdapter();
    case 'openai':
      return new OpenAIAdapter();
    case 'grok':
      return new GrokAdapter();
    case 'mock':
      return new MockAdapter();
    default:
      throw new Error(
        `Unknown LLM_PROVIDER="${process.env.LLM_PROVIDER}". Use: deepseek | openai | grok | mock`
      );
  }
}

/**
 * 获取当前 LLM 提供方（单例，按 env 热加载：每次读取时若 env 未变可缓存）
 */
export function getLLMProvider(): LLMProvider {
  if (!defaultProvider) {
    defaultProvider = createProvider();
  }
  return defaultProvider;
}

/**
 * 重置单例（用于测试或配置热加载后切换 provider）
 */
export function resetLLMProvider(): void {
  defaultProvider = null;
}

export { DeepSeekAdapter, OpenAIAdapter, GrokAdapter, MockAdapter };
