/**
 * ClawCommerce Content Skill - 小红书发帖
 * Uses browser-orchestrator + anti-detection; posts copy/media per ErChuangScript.
 * @module content/skills/xiaohongshu-post
 */
export const name = 'xiaohongshu-post';
export const platform = 'xiaohongshu';
/**
 * Execute 小红书发帖: navigate to create page, fill copy, upload media, submit.
 * Full implementation will use orchestrator.type/click/scroll and platform-specific selectors.
 */
export async function run(ctx) {
    const { script, orchestrator } = ctx;
    if (script.platform !== 'xiaohongshu') {
        return { ok: false, error: 'Platform mismatch' };
    }
    // TODO: orchestrator.navigate to xiaohongshu create page
    // TODO: orchestrator.type for caption (script.copy)
    // TODO: upload mediaPaths if any
    // TODO: orchestrator.click submit, wait for success, take screenshot
    await orchestrator.screenshot(`/tmp/xiaohongshu-post-${Date.now()}.png`);
    return { ok: true, screenshotPath: `/tmp/xiaohongshu-post-${Date.now()}.png` };
}
//# sourceMappingURL=xiaohongshu-post.js.map