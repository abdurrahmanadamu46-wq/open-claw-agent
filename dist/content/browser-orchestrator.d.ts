/**
 * ClawCommerce Content - Playwright 反检测底座
 * 封装 Playwright，注入 stealth 逻辑（等价 puppeteer-extra-plugin-stealth）。
 * Canvas/WebGL/User-Agent 指纹随机化；人类化延迟 + 行为库（human-cursor 风格）。
 * @module content/browser-orchestrator
 */
import type { PlatformId } from '../agent/types.js';
import { type AntiDetectionConfig } from './anti-detection.js';
export interface BrowserOrchestratorOptions {
    /** CDP 或 browser endpoint（从节点获取） */
    browserWSEndpoint?: string;
    platform: PlatformId;
    /** 人类化延迟范围 [min, max] ms，默认 200-800 */
    delayRange?: [number, number];
    /** 反检测配置（UA、指纹池） */
    antiDetection?: AntiDetectionConfig;
}
export interface ActionResult {
    ok: boolean;
    screenshotPath?: string;
    error?: string;
    durationMs: number;
}
/**
 * 反检测底座：指纹随机化 + 人类化延迟。
 * 具体 launch/connect 由调用方注入（避免强依赖 playwright 安装顺序）。
 */
export declare class BrowserOrchestrator {
    private options;
    private fingerprint;
    constructor(options: BrowserOrchestratorOptions);
    /** 供 launch 使用的 User-Agent（指纹随机化） */
    getUserAgent(): string;
    /** 供 launch 使用的 viewport（指纹随机化） */
    getViewport(): {
        width: number;
        height: number;
    };
    /** Stealth launch 参数（注入等价 puppeteer-extra-plugin-stealth 的 Chrome 参数） */
    getStealthArgs(): string[];
    /**
     * 人类化延迟（正态分布），每次操作前调用。
     * 确保鼠标移动、点击、滑动 100% 模拟真人。
     */
    humanDelay(): Promise<void>;
    /** 同步获取下一次延迟 ms（用于非 async 场景） */
    nextDelayMs(): number;
    /** Navigate：先 humanDelay 再执行（实际 page 由注入） */
    navigate(_url: string): Promise<ActionResult>;
    /** Type：人类化间隔（实际由注入的 page 执行） */
    type(_selector: string, _text: string): Promise<ActionResult>;
    /** Click：人类化移动+点击（可接 human-cursor 贝塞尔轨迹） */
    click(_selector: string): Promise<ActionResult>;
    /** Scroll：人类化 delta */
    scroll(_deltaY: number): Promise<ActionResult>;
    screenshot(path: string): Promise<ActionResult>;
    close(): Promise<void>;
}
//# sourceMappingURL=browser-orchestrator.d.ts.map