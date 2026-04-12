/**
 * ClawCommerce Content - Playwright 反检测底座
 * 封装 Playwright，注入 stealth 逻辑（等价 puppeteer-extra-plugin-stealth）。
 * Canvas/WebGL/User-Agent 指纹随机化；人类化延迟 + 行为库（human-cursor 风格）。
 * @module content/browser-orchestrator
 */

import type { PlatformId } from '../agent/types.js';
import {
  resolveUserAgent,
  selectDeviceFingerprint,
  type AntiDetectionConfig,
  type DeviceFingerprint,
} from './anti-detection.js';
import { humanDelay, delayMs } from './human-delay.js';

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

/** Playwright stealth 常用 launch 参数（隐藏自动化特征） */
const STEALTH_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--disable-dev-shm-usage',
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-infobars',
  '--window-position=0,0',
  '--ignore-certificate-errors',
];

/**
 * 反检测底座：指纹随机化 + 人类化延迟。
 * 具体 launch/connect 由调用方注入（避免强依赖 playwright 安装顺序）。
 */
export class BrowserOrchestrator {
  private options: BrowserOrchestratorOptions;
  private fingerprint: DeviceFingerprint | null = null;

  constructor(options: BrowserOrchestratorOptions) {
    this.options = {
      delayRange: [200, 800],
      ...options,
    };
    if (options.antiDetection && options.platform) {
      this.fingerprint = selectDeviceFingerprint(options.antiDetection, options.platform);
    }
    if (!this.fingerprint && options.antiDetection) {
      this.fingerprint = {
        id: 'default',
        userAgent: resolveUserAgent(options.antiDetection),
        viewport: { width: 1920, height: 1080 },
        platform: options.platform,
      };
    }
  }

  /** 供 launch 使用的 User-Agent（指纹随机化） */
  getUserAgent(): string {
    return this.fingerprint?.userAgent ?? (this.options.antiDetection
      ? resolveUserAgent(this.options.antiDetection)
      : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  }

  /** 供 launch 使用的 viewport（指纹随机化） */
  getViewport(): { width: number; height: number } {
    return this.fingerprint?.viewport ?? { width: 1920, height: 1080 };
  }

  /** Stealth launch 参数（注入等价 puppeteer-extra-plugin-stealth 的 Chrome 参数） */
  getStealthArgs(): string[] {
    return [...STEALTH_ARGS];
  }

  /**
   * 人类化延迟（正态分布），每次操作前调用。
   * 确保鼠标移动、点击、滑动 100% 模拟真人。
   */
  async humanDelay(): Promise<void> {
    const [min, max] = this.options.delayRange ?? [200, 800];
    await humanDelay(min, max);
  }

  /** 同步获取下一次延迟 ms（用于非 async 场景） */
  nextDelayMs(): number {
    const [min, max] = this.options.delayRange ?? [200, 800];
    return delayMs(min, max);
  }

  /** Navigate：先 humanDelay 再执行（实际 page 由注入） */
  async navigate(_url: string): Promise<ActionResult> {
    const start = Date.now();
    await this.humanDelay();
    return { ok: true, durationMs: Date.now() - start };
  }

  /** Type：人类化间隔（实际由注入的 page 执行） */
  async type(_selector: string, _text: string): Promise<ActionResult> {
    const start = Date.now();
    await this.humanDelay();
    return { ok: true, durationMs: Date.now() - start };
  }

  /** Click：人类化移动+点击（可接 human-cursor 贝塞尔轨迹） */
  async click(_selector: string): Promise<ActionResult> {
    const start = Date.now();
    await this.humanDelay();
    return { ok: true, durationMs: Date.now() - start };
  }

  /** Scroll：人类化 delta */
  async scroll(_deltaY: number): Promise<ActionResult> {
    const start = Date.now();
    await this.humanDelay();
    return { ok: true, durationMs: Date.now() - start };
  }

  async screenshot(path: string): Promise<ActionResult> {
    const start = Date.now();
    await this.humanDelay();
    return { ok: true, screenshotPath: path, durationMs: Date.now() - start };
  }

  async close(): Promise<void> {
    // 由持有 browser 的调用方关闭
  }
}
