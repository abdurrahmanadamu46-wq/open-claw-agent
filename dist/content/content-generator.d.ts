/**
 * ClawCommerce Content - LLM-driven 二创 script generator
 * Uses prompt-engine + RAG; calls LLM (Grok/Claude/GPT-4o); outputs ErChuangScript.
 * PM v1.8：分镜字数/时长校验 validateClipLogic，校验不通过本地 retry 最多 3 次。
 * @module content/content-generator
 */
import type { ContentGeneratorOptions, ErChuangScript, Clip, VideoScriptWithClips } from './types.js';
export interface LLMAdapter {
    complete(options: {
        system?: string;
        user: string;
        model?: string;
    }): Promise<string>;
}
/**
 * PM v1.8 物理逻辑校验：分镜 narration 字数必须在 duration_seconds 内能读完。
 * 若某分镜 2 秒却塞了 20 字，直接拦截并返回错误信息供 LLM 重试。
 */
export declare function validateClipLogic(clips: Clip[], charsPerSecond?: number): {
    valid: boolean;
    errors: string[];
};
/**
 * Generate 二创 script from benchmark accounts and options.
 * 1. Load prompt template (industry + platform)
 * 2. Build RAG from benchmark recent contents
 * 3. Render prompt, call LLM, parse output into ErChuangScript
 */
export declare function generateErChuangScript(options: ContentGeneratorOptions, llm: LLMAdapter): Promise<ErChuangScript | null>;
/**
 * 生成带分镜的视频脚本，并在本地做 validateClipLogic 校验；不通过则带错误提示重试，最多 3 次。
 * 3 次仍失败则抛出，由调用方将节点标记为异常挂起。
 */
export declare function generateVideoScriptWithClips(industryTemplateId: string, options: {
    systemPrompt?: string;
    userPrompt: string;
    llm: LLMAdapter;
    model?: string;
}): Promise<VideoScriptWithClips>;
//# sourceMappingURL=content-generator.d.ts.map