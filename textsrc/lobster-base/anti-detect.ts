/**
 * 龙虾底座 — 防风控：吸收 AdsPower 防封锁环境
 * playwright-extra + stealth 插件（或内置注入抹除 webdriver）+ 随机 UA + 每账号独立 Proxy
 * 运行前需安装：npm install playwright-extra playwright
 * 可选：npm install puppeteer-extra-plugin-stealth 以增强隐藏（与 playwright-extra 配合）
 */

export interface Point {
  x: number;
  y: number;
}

/** 默认 User-Agent 池，用于随机化指纹（多账号物理隔离时每账号可绑独立 Proxy） */
export const DEFAULT_USER_AGENT_POOL = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
];

function pickRandomUserAgent(pool?: string[]): string {
  const list = pool?.length ? pool : DEFAULT_USER_AGENT_POOL;
  return list[Math.floor(Math.random() * list.length)] ?? DEFAULT_USER_AGENT_POOL[0]!;
}

/**
 * 真实感鼠标轨迹：从 from 到 to 生成带随机扰动的路径点（贝塞尔或线性+抖动）
 * 龙虾节点执行时按此路径逐点移动，降低自动化检测率
 */
export function humanLikeMousePath(
  from: Point,
  to: Point,
  steps: number = 15
): Point[] {
  if (steps < 2) return [from, to];
  const path: Point[] = [];
  const jitter = 2;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = from.x + (to.x - from.x) * t + (Math.random() - 0.5) * jitter;
    const y = from.y + (to.y - from.y) * t + (Math.random() - 0.5) * jitter;
    path.push({ x: Math.round(x), y: Math.round(y) });
  }
  return path;
}

/**
 * 抹除 webdriver 标记（等价 puppeteer-extra-plugin-stealth 核心能力）
 * 通过 context.addInitScript 注入到每个新页面
 */
export const STEALTH_WEBDRIVER_MASK_SCRIPT = `
(function() {
  if (window.__clawStealthInjected) return;
  window.__clawStealthInjected = true;
  Object.defineProperty(navigator, 'webdriver', { get: function() { return undefined; }, configurable: true });
  try { delete navigator.__proto__.webdriver; } catch (e) {}
})();
`;

/**
 * Canvas/WebGL 指纹伪装 — 注入脚本占位
 * 生产实现：在 page.addInitScript 中覆盖 getParameter / toDataURL 等，返回稳定噪声
 */
export const CANVAS_WEBGL_MASK_SCRIPT = `
(function() {
  if (window.__clawCanvasMaskInjected) return;
  window.__clawCanvasMaskInjected = true;
})();
`;

/** 启动参数：减少自动化特征（与 playwright-extra + stealth 配合） */
export const STEALTH_LAUNCH_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-web-security',
  '--disable-features=IsolateOrigins,site-per-process',
];

/**
 * 每账号独立 Proxy 配置 — 多账号环境 100% 物理隔离（吸收 AdsPower）
 * 与 profile 一一绑定：platformId + accountId 对应一个 proxy 配置
 */
export interface StealthProxyConfig {
  server: string;
  username?: string;
  password?: string;
}

export interface StealthBrowserOptions {
  headless?: boolean;
  userDataDir?: string;
  args?: string[];
  /** 随机化 User-Agent，若传则从池中随机选取 */
  userAgentPool?: string[];
  /** 单次指定 UA（覆盖 userAgentPool） */
  userAgent?: string;
  /** 为当前账号绑定的独立 Proxy，确保多账号物理隔离 */
  proxy?: StealthProxyConfig;
}

export interface StealthBrowserResult {
  browser: unknown;
  context: unknown;
  close: () => Promise<void>;
}

/**
 * 启动带 stealth 的浏览器（需安装 playwright-extra + playwright）
 * 注入代码抹除 webdriver、随机化 User-Agent，并支持每账号独立 Proxy
 */
export async function launchStealthBrowser(options: StealthBrowserOptions = {}): Promise<StealthBrowserResult> {
  const {
    headless = true,
    userDataDir,
    args = STEALTH_LAUNCH_ARGS,
    userAgentPool,
    userAgent: explicitUserAgent,
    proxy,
  } = options;
  const userAgent = explicitUserAgent ?? pickRandomUserAgent(userAgentPool);
  try {
    // @ts-expect-error - 未安装时无类型，运行时 catch 会处理
    const playwrightExtra = await import('playwright-extra').catch(() => null);
    const chromium = playwrightExtra?.default?.chromium ?? (playwrightExtra as { chromium?: unknown })?.chromium;
    if (!chromium?.launch) {
      throw new Error(
        'playwright-extra not installed. Run: npm install playwright-extra playwright'
      );
    }
    // 可选：puppeteer-extra-plugin-stealth（与 playwright-extra 配合，未安装则跳过）
    const stealthModuleId = 'puppeteer-extra-plugin-stealth';
    try {
      const m = await import(/* @vite-ignore */ stealthModuleId).catch(() => null);
      const stealth = m && typeof (m as { default?: () => unknown }).default === 'function'
        ? (m as { default: () => unknown }).default()
        : (m as { default?: unknown })?.default;
      if (stealth && typeof (chromium as { use?: (plugin: unknown) => void }).use === 'function') {
        (chromium as { use: (plugin: unknown) => void }).use(stealth);
      }
    } catch {
      // 无 stealth 插件时仅依赖内置 STEALTH_WEBDRIVER_MASK_SCRIPT
    }
    const browser = await chromium.launch({
      headless,
      args: [...args],
      ...(userDataDir && { channel: undefined, executablePath: undefined }),
    });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent,
      ...(proxy && {
        proxy: {
          server: proxy.server,
          ...(proxy.username && { username: proxy.username }),
          ...(proxy.password && { password: proxy.password }),
        },
      }),
      ...(userDataDir && { storageState: undefined }),
    });
    // 注入抹除 webdriver 等标记（与 stealth 插件互补）
    await context.addInitScript({ content: STEALTH_WEBDRIVER_MASK_SCRIPT });
    const close = async () => {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    };
    return { browser, context, close };
  } catch (e) {
    if (e instanceof Error && e.message.includes('playwright-extra')) throw e;
    throw new Error(
      `launchStealthBrowser failed. Install: npm install playwright-extra playwright. Original: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}
