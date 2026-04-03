/**
 * ClawCommerce Content - Types for prompt-engine, content-generator, skills
 * @module content/types
 */

import type { PlatformId } from '../agent/types.js';
export type { PlatformId };

/** Industry key for prompt templates (50+ industries) */
export type IndustryId =
  | 'beauty' | 'fitness' | 'food' | 'tech' | 'travel' | 'fashion' | 'parenting'
  | 'education' | 'finance' | 'health' | 'entertainment' | 'automotive' | 'realestate'
  | 'pet' | 'wedding' | 'home' | 'sports' | 'gaming' | 'music' | 'art'
  | string;

/** One benchmark account (from campaign config) */
export interface BenchmarkAccount {
  id: string;
  handle: string;
  platform: PlatformId;
  /** Latest crawled content snippets for RAG */
  recentContents?: CrawledContent[];
}

/** Crawled content from benchmark (for 二创) */
export interface CrawledContent {
  id: string;
  accountId: string;
  platform: PlatformId;
  contentType: 'text' | 'image' | 'video' | 'carousel';
  text?: string;
  /** URLs or base64 thumbnails */
  mediaUrls?: string[];
  publishedAt?: string;
  engagement?: { likes?: number; comments?: number; shares?: number };
}

/** Prompt template schema (versioned JSON per industry) */
export interface PromptTemplate {
  version: string;
  industry: IndustryId;
  platform: PlatformId;
  /** Template purpose: copy_rewrite | video_script | mix_cut_instructions | platform_adapt */
  purpose: 'copy_rewrite' | 'video_script' | 'mix_cut_instructions' | 'platform_adapt' | 'full_brief';
  /** System or user prompt with {{placeholders}} */
  systemPrompt?: string;
  userPrompt: string;
  /** Variable names that must be supplied when rendering */
  requiredVars: string[];
  /** Optional RAG context key (e.g. "benchmark_contents") */
  ragContextKey?: string;
}

/** Rendered prompt ready for LLM */
export interface RenderedPrompt {
  system?: string;
  user: string;
  variables: Record<string, string>;
}

/** 二创 script output (from content-generator) */
export interface ErChuangScript {
  platform: PlatformId;
  copy: string;
  videoScript?: string;
  mixCutInstructions?: string[];
  hashtags?: string[];
  postAt?: string;
  metadata?: Record<string, unknown>;
}

/** PM v1.8 单条分镜（语意边界 + 时长/字数校验） */
export interface Clip {
  duration_seconds: number;
  narration: string;
  /** 可选：画面描述 */
  visual_hint?: string;
}

/** 带分镜数组的视频脚本（供 validateClipLogic 校验） */
export interface VideoScriptWithClips {
  clips: Clip[];
  total_duration_seconds?: number;
}

/** Options for content generator */
export interface ContentGeneratorOptions {
  industry: IndustryId;
  platform: PlatformId;
  benchmarkAccounts: BenchmarkAccount[];
  /** Max items to use from RAG (crawled content) */
  maxRagItems?: number;
  /** LLM model name or alias */
  model?: string;
}
