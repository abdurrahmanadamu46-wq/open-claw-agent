/**
 * LLM 抽象层单测 — Mock 模式下验证接口与结构化输出（爆款拆解 JSON）
 */

import { getLLMProvider, resetLLMProvider } from '../adapters/index.js';
import type { LLMMessage } from '../provider.interface.js';

// 爆款拆解输出结构（雷达大脑用）
const VIRAL_DISASSEMBLE_SCHEMA = {
  type: 'object',
  required: ['hook', 'painPoints', 'sellingPoints'],
  properties: {
    hook: { type: 'string', description: '前3秒钩子文案' },
    painPoints: { type: 'array', items: { type: 'string' }, description: '用户痛点' },
    sellingPoints: { type: 'array', items: { type: 'string' }, description: '产品卖点' },
  },
};

describe('LLM Provider (mock)', () => {
  const originalProvider = process.env.LLM_PROVIDER;

  afterEach(() => {
    resetLLMProvider();
    if (originalProvider !== undefined) process.env.LLM_PROVIDER = originalProvider;
    else delete process.env.LLM_PROVIDER;
  });

  it('getLLMProvider returns MockAdapter when LLM_PROVIDER=mock', () => {
    process.env.LLM_PROVIDER = 'mock';
    const provider = getLLMProvider();
    expect(provider.name).toBe('mock');
  });

  it('chat() returns mock string', async () => {
    process.env.LLM_PROVIDER = 'mock';
    const provider = getLLMProvider();
    const messages: LLMMessage[] = [{ role: 'user', content: 'Hello' }];
    const out = await provider.chat(messages);
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
  });

  it('structuredJson() returns parseable 爆款拆解 JSON', async () => {
    process.env.LLM_PROVIDER = 'mock';
    const provider = getLLMProvider();
    const messages: LLMMessage[] = [
      { role: 'user', content: '请拆解以下视频文案：这款面膜太好用了...' },
    ];
    const result = await provider.structuredJson<{
      hook: string;
      painPoints: string[];
      sellingPoints: string[];
    }>(messages, VIRAL_DISASSEMBLE_SCHEMA);

    expect(result).toBeDefined();
    expect(typeof result.hook).toBe('string');
    expect(Array.isArray(result.painPoints)).toBe(true);
    expect(Array.isArray(result.sellingPoints)).toBe(true);
    expect(result.painPoints.every((p) => typeof p === 'string')).toBe(true);
    expect(result.sellingPoints.every((s) => typeof s === 'string')).toBe(true);
  });

  it('structuredJson result can be serialized and re-parsed', async () => {
    process.env.LLM_PROVIDER = 'mock';
    const provider = getLLMProvider();
    const messages: LLMMessage[] = [{ role: 'user', content: 'dummy' }];
    const result = await provider.structuredJson(messages, VIRAL_DISASSEMBLE_SCHEMA);
    const str = JSON.stringify(result);
    const parsed = JSON.parse(str);
    expect(parsed).toEqual(result);
  });
});
