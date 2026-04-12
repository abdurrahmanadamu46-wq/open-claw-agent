/**
 * ClawCommerce Content - Prompt template engine + RAG
 * Loads versioned JSON templates per industry/platform, renders with variables, supports RAG context.
 * @module content/prompt-engine
 */
import type { PromptTemplate, RenderedPrompt, IndustryId, PlatformId, CrawledContent } from './types.js';
/**
 * Load a prompt template from JSON by industry and platform.
 * Path: templates/{industry}/{platform}_{purpose}.json or templates/{industry}/default.json
 */
export declare function loadTemplate(industry: IndustryId, platform: PlatformId, purpose?: PromptTemplate['purpose']): PromptTemplate | null;
/**
 * List available industry IDs (from template subdirs).
 * Falls back to built-in list if filesystem read fails.
 */
export declare function listIndustries(): IndustryId[];
/**
 * Render template with variables and optional RAG context.
 * Replaces {{varName}} and injects ragContextKey block if present.
 */
export declare function render(template: PromptTemplate, variables: Record<string, string>, ragContext?: {
    key: string;
    contents: CrawledContent[];
}): RenderedPrompt;
/**
 * Build RAG context string from benchmark accounts' recent contents (for prompt injection).
 */
export declare function buildRagContext(contents: CrawledContent[], maxItems?: number): string;
export declare function getSemanticBoundaryInstructions(industryTemplateId: string): {
    fragment: string;
    min_clips: number;
    max_clips: number;
};
/** 供 System Prompt 追加的语意分镜约束（含 {{min_clips}} {{max_clips}} 占位） */
export declare const SEMANTIC_BOUNDARY_SYSTEM_FRAGMENT: string;
export type { PromptTemplate, RenderedPrompt, IndustryId, PlatformId, CrawledContent };
//# sourceMappingURL=prompt-engine.d.ts.map