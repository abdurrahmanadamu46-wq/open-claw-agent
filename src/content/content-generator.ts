/**
 * ClawCommerce Content - LLM-driven 二创 script generator
 * Uses prompt-engine + RAG; calls LLM (Grok/Claude/GPT-4o); outputs ErChuangScript.
 * PM v1.8：分镜字数/时长校验 validateClipLogic，校验不通过本地 retry 最多 3 次。
 * @module content/content-generator
 */

import { loadTemplate, render, buildRagContext, getSemanticBoundaryInstructions } from './prompt-engine.js';
import type {
  ContentGeneratorOptions,
  ErChuangScript,
  BenchmarkAccount,
  CrawledContent,
  Clip,
  VideoScriptWithClips,
} from './types.js';

export interface LLMAdapter {
  complete(options: { system?: string; user: string; model?: string }): Promise<string>;
}

/** 正常语速约 4~5 字/秒（中文） */
const DEFAULT_CHARS_PER_SECOND = 5;

/**
 * PM v1.8 物理逻辑校验：分镜 narration 字数必须在 duration_seconds 内能读完。
 * 若某分镜 2 秒却塞了 20 字，直接拦截并返回错误信息供 LLM 重试。
 */
export function validateClipLogic(
  clips: Clip[],
  charsPerSecond: number = DEFAULT_CHARS_PER_SECOND
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    const maxChars = Math.floor(clip.duration_seconds * charsPerSecond);
    const charCount = (clip.narration ?? '').length;
    if (charCount > maxChars) {
      errors.push(
        `第 ${i + 1} 分镜文案过长，${clip.duration_seconds}秒内无法读完（当前${charCount}字，约需${Math.ceil(charCount / charsPerSecond)}秒），请重写或拆分。`
      );
    }
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Generate 二创 script from benchmark accounts and options.
 * 1. Load prompt template (industry + platform)
 * 2. Build RAG from benchmark recent contents
 * 3. Render prompt, call LLM, parse output into ErChuangScript
 */
export async function generateErChuangScript(
  options: ContentGeneratorOptions,
  llm: LLMAdapter
): Promise<ErChuangScript | null> {
  const { industry, platform, benchmarkAccounts, maxRagItems = 20, model } = options;
  const contents: CrawledContent[] = [];
  for (const acc of benchmarkAccounts) {
    for (const c of acc.recentContents ?? []) {
      contents.push(c);
    }
  }
  const template = loadTemplate(industry, platform, 'full_brief');
  if (!template) return null;
  const ragContext = buildRagContext(contents, maxRagItems);
  const rendered = render(template, {}, { key: 'benchmark_contents', contents });
  const raw = await llm.complete({
    system: rendered.system,
    user: rendered.user,
    model,
  });
  return parseScriptFromLLM(raw, platform, ragContext);
}

/**
 * Parse LLM text output into ErChuangScript (heuristic; can be replaced by structured output).
 */
function parseScriptFromLLM(
  raw: string,
  platform: string,
  _ragContext: string
): ErChuangScript {
  const lines = raw.split('\n').filter(Boolean);
  const copyLines: string[] = [];
  const hashtags: string[] = [];
  let inTags = false;
  for (const line of lines) {
    if (/标签|#|hashtag/i.test(line)) {
      inTags = true;
      const matches = line.match(/#[\w\u4e00-\u9fa5]+/g);
      if (matches) hashtags.push(...matches);
    } else if (!inTags) {
      copyLines.push(line.trim());
    }
  }
  return {
    platform: platform as ErChuangScript['platform'],
    copy: copyLines.join('\n').trim() || raw.slice(0, 500),
    hashtags: hashtags.length > 0 ? hashtags : undefined,
    metadata: { rawLength: raw.length },
  };
}

const MAX_CLIP_LOGIC_RETRIES = 3;

/**
 * 生成带分镜的视频脚本，并在本地做 validateClipLogic 校验；不通过则带错误提示重试，最多 3 次。
 * 3 次仍失败则抛出，由调用方将节点标记为异常挂起。
 */
export async function generateVideoScriptWithClips(
  industryTemplateId: string,
  options: {
    systemPrompt?: string;
    userPrompt: string;
    llm: LLMAdapter;
    model?: string;
  }
): Promise<VideoScriptWithClips> {
  const { min_clips, max_clips, fragment } = getSemanticBoundaryInstructions(industryTemplateId);
  const systemPrompt = [
    options.systemPrompt ?? '',
    fragment,
    '请输出 JSON：{ "clips": [ { "duration_seconds": number, "narration": "文案" } ] }',
  ]
    .filter(Boolean)
    .join('\n\n');
  let lastErrors: string[] = [];
  for (let attempt = 1; attempt <= MAX_CLIP_LOGIC_RETRIES; attempt++) {
    const raw = await options.llm.complete({
      system: systemPrompt,
      user: lastErrors.length
        ? `上一轮校验未通过，请按以下提示修改后重新输出 JSON：\n${lastErrors.join('\n')}`
        : options.userPrompt,
      model: options.model,
    });
    const parsed = parseClipsFromLLM(raw);
    if (!parsed.clips?.length) {
      lastErrors = ['未解析到有效 clips 数组，请输出 { "clips": [ ... ] }'];
      continue;
    }
    const { valid, errors } = validateClipLogic(parsed.clips);
    if (valid) return parsed;
    lastErrors = errors;
  }
  throw new Error(
    `分镜逻辑校验 ${MAX_CLIP_LOGIC_RETRIES} 次未通过：${lastErrors.join('; ')}。节点将标记为异常挂起。`
  );
}

function parseClipsFromLLM(raw: string): VideoScriptWithClips {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { clips: [] };
  try {
    const data = JSON.parse(jsonMatch[0]) as { clips?: Array<{ duration_seconds?: number; narration?: string }> };
    const clips: Clip[] = (data.clips ?? []).map((c) => ({
      duration_seconds: Number(c.duration_seconds) || 2,
      narration: String(c.narration ?? '').trim(),
    }));
    return { clips };
  } catch {
    return { clips: [] };
  }
}
