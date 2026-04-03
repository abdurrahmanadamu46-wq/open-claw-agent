/**
 * ClawCommerce Content - Prompt template engine + RAG
 * Loads versioned JSON templates per industry/platform, renders with variables, supports RAG context.
 * @module content/prompt-engine
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PromptTemplate, RenderedPrompt, IndustryId, PlatformId, CrawledContent } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, 'templates');

const VAR_REGEX = /\{\{(\w+)\}\}/g;

/**
 * Load a prompt template from JSON by industry and platform.
 * Path: templates/{industry}/{platform}_{purpose}.json or templates/{industry}/default.json
 */
export function loadTemplate(
  industry: IndustryId,
  platform: PlatformId,
  purpose: PromptTemplate['purpose'] = 'full_brief'
): PromptTemplate | null {
  const industryDir = join(TEMPLATES_DIR, industry);
  if (!existsSync(industryDir)) return null;
  const candidates = [
    join(industryDir, `${platform}_${purpose}.json`),
    join(industryDir, `${platform}.json`),
    join(industryDir, 'default.json'),
  ];
  for (const path of candidates) {
    if (existsSync(path)) {
      try {
        const raw = readFileSync(path, 'utf-8');
        const t = JSON.parse(raw) as PromptTemplate;
        if (t.industry && t.userPrompt) return t;
        return { ...t, industry, platform, purpose };
      } catch {
        continue;
      }
    }
  }
  return null;
}

/**
 * List available industry IDs (from template subdirs).
 * Falls back to built-in list if filesystem read fails.
 */
export function listIndustries(): IndustryId[] {
  try {
    const entries = readdirSync(TEMPLATES_DIR, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name as IndustryId);
    if (dirs.length > 0) return dirs;
  } catch {
    // fallback
  }
  return [
    'beauty', 'fitness', 'food', 'tech', 'travel', 'fashion', 'parenting',
    'education', 'finance', 'health', 'entertainment', 'automotive', 'realestate',
    'pet', 'wedding', 'home', 'sports', 'gaming', 'music', 'art',
  ];
}

/**
 * Render template with variables and optional RAG context.
 * Replaces {{varName}} and injects ragContextKey block if present.
 */
export function render(
  template: PromptTemplate,
  variables: Record<string, string>,
  ragContext?: { key: string; contents: CrawledContent[] }
): RenderedPrompt {
  const merged = { ...variables };
  if (ragContext?.contents?.length && template.ragContextKey) {
    const text = ragContext.contents
      .slice(0, 20)
      .map((c) => (c.text ? `[${c.contentType}] ${c.text}` : ''))
      .filter(Boolean)
      .join('\n---\n');
    merged[template.ragContextKey] = text || '(no content)';
  }
  const required = new Set(template.requiredVars ?? []);
  for (const name of required) {
    if (merged[name] === undefined || merged[name] === '') {
      merged[name] = '';
    }
  }
  const replace = (s: string): string =>
    s.replace(VAR_REGEX, (_, name) => merged[name] ?? '');
  return {
    system: template.systemPrompt ? replace(template.systemPrompt) : undefined,
    user: replace(template.userPrompt),
    variables: merged,
  };
}

/**
 * Build RAG context string from benchmark accounts' recent contents (for prompt injection).
 */
export function buildRagContext(contents: CrawledContent[], maxItems: number = 20): string {
  return contents
    .slice(0, maxItems)
    .map((c) => (c.text ? `[${c.contentType}] ${c.text}` : ''))
    .filter(Boolean)
    .join('\n---\n') || '(no content)';
}

/**
 * PM v1.8 语意分镜约束：分镜必须按意群与标点切分，长度在区间内浮动。
 * 与 shared/contracts TEMPLATE_DYNAMIC_RULES 同步。
 */
import { TEMPLATE_DYNAMIC_RULES } from '../shared/contracts.js';

export function getSemanticBoundaryInstructions(industryTemplateId: string): {
  fragment: string;
  min_clips: number;
  max_clips: number;
} {
  const rules = TEMPLATE_DYNAMIC_RULES[industryTemplateId] ?? { min_clips: 3, max_clips: 6 };
  const fragment = [
    '你必须根据台词的完整意群和语意起伏来切分画面。',
    '分镜的切换必须且只能发生在标点符号处（如逗号、句号、问号、叹号）。',
    '严禁在一个完整的从句或连贯的短语中间进行物理切割。',
    `根据内容节奏，分镜总数请在 ${rules.min_clips} 到 ${rules.max_clips} 之间自由浮动，以保证视频的自然呼吸感。`,
  ].join('\n');
  return { fragment, min_clips: rules.min_clips, max_clips: rules.max_clips };
}

/** 供 System Prompt 追加的语意分镜约束（含 {{min_clips}} {{max_clips}} 占位） */
export const SEMANTIC_BOUNDARY_SYSTEM_FRAGMENT = [
  '你必须根据台词的完整意群和语意起伏来切分画面。',
  '分镜的切换必须且只能发生在标点符号处（如逗号、句号、问号、叹号）。',
  '严禁在一个完整的从句或连贯的短语中间进行物理切割。',
  '根据内容节奏，分镜总数请在 {{min_clips}} 到 {{max_clips}} 之间自由浮动，以保证视频的自然呼吸感。',
].join('\n');

export type { PromptTemplate, RenderedPrompt, IndustryId, PlatformId, CrawledContent };
