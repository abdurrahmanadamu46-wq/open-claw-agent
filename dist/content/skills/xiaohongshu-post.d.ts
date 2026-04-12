/**
 * ClawCommerce Content Skill - 小红书发帖
 * Uses browser-orchestrator + anti-detection; posts copy/media per ErChuangScript.
 * @module content/skills/xiaohongshu-post
 */
import type { BrowserOrchestrator } from '../browser-orchestrator.js';
import type { ErChuangScript } from '../types.js';
export declare const name = "xiaohongshu-post";
export declare const platform: "xiaohongshu";
export interface SkillContext {
    script: ErChuangScript;
    orchestrator: BrowserOrchestrator;
    /** Optional image/video paths to upload */
    mediaPaths?: string[];
}
export interface SkillResult {
    ok: boolean;
    postId?: string;
    screenshotPath?: string;
    error?: string;
}
/**
 * Execute 小红书发帖: navigate to create page, fill copy, upload media, submit.
 * Full implementation will use orchestrator.type/click/scroll and platform-specific selectors.
 */
export declare function run(ctx: SkillContext): Promise<SkillResult>;
//# sourceMappingURL=xiaohongshu-post.d.ts.map