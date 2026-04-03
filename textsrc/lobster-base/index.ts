/**
 * 龙虾底座 — 统一导出
 */

export {
  humanLikeMousePath,
  STEALTH_LAUNCH_ARGS,
  STEALTH_WEBDRIVER_MASK_SCRIPT,
  CANVAS_WEBGL_MASK_SCRIPT,
  DEFAULT_USER_AGENT_POOL,
  launchStealthBrowser,
} from './anti-detect.js';
export type { Point, StealthBrowserOptions, StealthBrowserResult, StealthProxyConfig } from './anti-detect.js';

export {
  getProfileDir,
  ensureProfileDir,
  getIsolationUserDataDir,
  DEFAULT_PROFILE_ROOT,
} from './cookie-isolation.js';
export type { ProfileIsolationConfig } from './cookie-isolation.js';

export type {
  CaptchaSolverProvider,
  CaptchaSolveOptions,
  CaptchaSolveResult,
} from './captcha-solver.interface.js';
export { getCaptchaSolver, resetCaptchaSolver } from './captcha-adapters/index.js';
