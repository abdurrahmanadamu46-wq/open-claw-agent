/**
 * ClawCommerce Content - 人类化延迟（正态分布）
 * 用于鼠标移动、点击、滑动等间隔，100% 模拟真人节奏。
 * @module content/human-delay
 */
/**
 * Box-Muller 近似：生成服从 N(mean, std^2) 的样本
 */
function normalSample(mean, std) {
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mean + std * z;
}
/**
 * 在 [min, max] 内取正态分布延迟（均值取中点，标准差使约 99% 落在区间内）
 * 用于 human-cursor、打字间隔、滚动间隔等。
 */
export function delayMs(min, max) {
    const mean = (min + max) / 2;
    const range = max - min;
    const std = range / 6;
    let ms = normalSample(mean, std);
    ms = Math.round(ms);
    if (ms < min)
        return min;
    if (ms > max)
        return max;
    return ms;
}
/**
 * Promise 延迟（用于 await humanDelay(200, 800)）
 */
export function humanDelay(minMs, maxMs) {
    return new Promise((resolve) => setTimeout(resolve, delayMs(minMs, maxMs)));
}
//# sourceMappingURL=human-delay.js.map