/**
 * Demo 录屏用：终端高亮日志（PM v1.17 第三幕）
 * 仅当 DEMO_LOGS=1 或 NODE_ENV=staging 时输出带 ANSI 颜色的可读行
 */

const DEMO_ENABLED =
  process.env.DEMO_LOGS === '1' || process.env.NODE_ENV === 'staging';

const C = {
  cyan: '\u001b[36m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  reset: '\u001b[0m',
};

export function demoLogBullMQ(campaignId: string): void {
  if (!DEMO_ENABLED) return;
  console.log(`${C.cyan}[BullMQ] Campaign ${campaignId} Acquired. Allocating Node...${C.reset}`);
}

export function demoLogPlaywright(): void {
  if (!DEMO_ENABLED) return;
  console.log(`${C.green}[Playwright] Stealth mode injected. Bypassing captcha...${C.reset}`);
}

export function demoLogLLMEngine(clips = 7): void {
  if (!DEMO_ENABLED) return;
  console.log(
    `${C.yellow}[LLM Engine] Validating narrative logic... ${clips} clips validated perfectly.${C.reset}`
  );
}
