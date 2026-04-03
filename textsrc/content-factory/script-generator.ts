/**
 * AI 内容工厂 — 剧本生成
 * 调用 LLM 生成结构化分镜剧本，根据视频时长自动决定分镜数：10秒=5、15秒=7、30秒=15
 */

import { getLLMProvider } from '../llm/adapters/index.js';
import type { LLMMessage } from '../llm/provider.interface.js';
import type { ViralDisassembleResult } from '../radar-brain/content-disassembler.js';

/** 单条分镜（可与 VideoGenerationService FinalScript 转换后对接：text=spoken_text, visual_prompt 可选） */
export interface SceneItem {
  /** 该镜文案/旁白 */
  text: string;
  /** 建议时长（秒），可选 */
  durationSeconds?: number;
  /** 画面描述，供 HeyGen/剪映等适配器「说一句换一镜」使用 */
  visual_prompt?: string;
}

/** 剧本输出结构 */
export interface ScriptOutput {
  /** 分镜列表，按顺序播放 */
  scenes: SceneItem[];
  /** 总时长（秒） */
  totalDurationSeconds: number;
}

/** 支持的视频时长 → 分镜数（规范要求） */
export const DURATION_SCENE_MAP = {
  10: 5,
  15: 7,
  30: 15,
} as const;

export type ScriptDuration = keyof typeof DURATION_SCENE_MAP;

function buildScriptSchema(numScenes: number): Record<string, unknown> {
  return {
    type: 'object',
    required: ['scenes', 'totalDurationSeconds'],
    properties: {
      scenes: {
        type: 'array',
        items: {
          type: 'object',
          required: ['text'],
          properties: {
            text: { type: 'string', description: '该镜文案/旁白' },
            durationSeconds: { type: 'number', description: '建议时长秒数' },
          },
        },
        minItems: numScenes,
        maxItems: numScenes,
      },
      totalDurationSeconds: { type: 'number' },
    },
  };
}

const SYSTEM_PROMPT = `你是短视频剧本专家。根据用户提供的钩子、痛点、卖点与主推文案，生成分镜剧本。
每个分镜一段文案（旁白/字幕），可带 durationSeconds。只输出合法 JSON，不要其他说明。`;

/**
 * 生成分镜剧本
 * @param input 主推卖点 + 可选爆款拆解结果
 * @param durationSeconds 10 | 15 | 30，决定分镜数量（5/7/15）
 */
export async function generateScript(
  input: {
    sellingPoints: string[];
    hook?: string;
    painPoints?: string[];
    productCopy?: string;
  },
  durationSeconds: ScriptDuration
): Promise<ScriptOutput> {
  const numScenes = DURATION_SCENE_MAP[durationSeconds];
  const llm = getLLMProvider();
  const parts: string[] = [
    `主推卖点：${input.sellingPoints.join('；')}`,
    input.hook != null ? `钩子（前3秒）：${input.hook}` : '',
    input.painPoints?.length ? `痛点：${input.painPoints.join('；')}` : '',
    input.productCopy ? `产品文案：${input.productCopy}` : '',
  ].filter(Boolean);
  const userContent = `请生成 ${durationSeconds} 秒短视频剧本，共 ${numScenes} 个分镜。\n\n${parts.join('\n')}`;
  const messages: LLMMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];
  const raw = await llm.structuredJson<ScriptOutput>(messages, buildScriptSchema(numScenes), {
    temperature: 0.5,
    maxTokens: 2048,
  });
  const scenes = Array.isArray(raw.scenes) ? raw.scenes : [];
  return {
    scenes: scenes.map((s) => ({
      text: typeof s.text === 'string' ? s.text : String(s.text ?? ''),
      durationSeconds: typeof s.durationSeconds === 'number' ? s.durationSeconds : undefined,
    })),
    totalDurationSeconds: typeof raw.totalDurationSeconds === 'number' ? raw.totalDurationSeconds : durationSeconds,
  };
}

/**
 * 从爆款拆解结果 + 时长生成剧本（便捷入口）
 */
export async function generateScriptFromViral(
  viral: ViralDisassembleResult,
  durationSeconds: ScriptDuration,
  productCopy?: string
): Promise<ScriptOutput> {
  return generateScript(
    {
      hook: viral.hook,
      painPoints: viral.painPoints,
      sellingPoints: viral.sellingPoints,
      productCopy,
    },
    durationSeconds
  );
}
