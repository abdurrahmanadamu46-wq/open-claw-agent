/**
 * 雷达大脑 — 爆款内容拆解
 * 调用 LLM 将视频/文案转录内容拆解为固定 JSON：Hook / 痛点 / 卖点
 */

import { getLLMProvider } from '../llm/adapters/index.js';
import type { LLMMessage } from '../llm/provider.interface.js';

/** 爆款拆解输出结构（与 LLM 单测 schema 一致） */
export interface ViralDisassembleResult {
  hook: string;
  painPoints: string[];
  sellingPoints: string[];
}

const VIRAL_DISASSEMBLE_SCHEMA = {
  type: 'object',
  required: ['hook', 'painPoints', 'sellingPoints'],
  properties: {
    hook: { type: 'string', description: '前3秒钩子文案' },
    painPoints: { type: 'array', items: { type: 'string' }, description: '用户痛点' },
    sellingPoints: { type: 'array', items: { type: 'string' }, description: '产品卖点' },
  },
};

const DEFAULT_SYSTEM_PROMPT = `你是一名短视频运营专家。请将用户提供的视频文案或转录文字，拆解为结构化内容：
- hook：前 3 秒吸引注意力的钩子句（一句或一段）；
- painPoints：用户痛点列表（多条简短句）；
- sellingPoints：产品/服务卖点列表（多条简短句）。
只输出合法 JSON，不要其他说明。`;

/**
 * 将转录文字拆解为 Hook / 痛点 / 卖点
 * @param transcript 视频转录文字或文案原文
 * @returns 结构化 JSON，可直接入库或供剧本生成使用
 */
export async function disassembleViralContent(transcript: string): Promise<ViralDisassembleResult> {
  const llm = getLLMProvider();
  const messages: LLMMessage[] = [
    { role: 'user', content: `请拆解以下内容：\n\n${transcript.slice(0, 8000)}` },
  ];
  const result = await llm.structuredJson<ViralDisassembleResult>(
    [{ role: 'system', content: DEFAULT_SYSTEM_PROMPT }, ...messages],
    VIRAL_DISASSEMBLE_SCHEMA,
    { temperature: 0.3, maxTokens: 1024 }
  );
  return {
    hook: result.hook ?? '',
    painPoints: Array.isArray(result.painPoints) ? result.painPoints : [],
    sellingPoints: Array.isArray(result.sellingPoints) ? result.sellingPoints : [],
  };
}
