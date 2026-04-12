/**
 * ClawCommerce Content - 人类化延迟（正态分布）
 * 用于鼠标移动、点击、滑动等间隔，100% 模拟真人节奏。
 * @module content/human-delay
 */
/**
 * 在 [min, max] 内取正态分布延迟（均值取中点，标准差使约 99% 落在区间内）
 * 用于 human-cursor、打字间隔、滚动间隔等。
 */
export declare function delayMs(min: number, max: number): number;
/**
 * Promise 延迟（用于 await humanDelay(200, 800)）
 */
export declare function humanDelay(minMs: number, maxMs: number): Promise<void>;
//# sourceMappingURL=human-delay.d.ts.map