/**
 * 打码平台工厂 — 根据 env 切换
 * CAPTCHA_SOLVER=mock | 2captcha | anticaptcha | tujian
 */

import type { CaptchaSolverProvider } from '../captcha-solver.interface.js';
import { MockCaptchaAdapter } from './mock-captcha.adapter.js';

let defaultSolver: CaptchaSolverProvider | null = null;

function createSolver(): CaptchaSolverProvider {
  const provider = (process.env.CAPTCHA_SOLVER ?? 'mock').toLowerCase();
  switch (provider) {
    case 'mock':
      return new MockCaptchaAdapter();
    case '2captcha':
    case 'anticaptcha':
    case 'tujian':
      throw new Error(`CAPTCHA_SOLVER=${provider} not implemented yet. Use mock.`);
    default:
      throw new Error(`Unknown CAPTCHA_SOLVER="${process.env.CAPTCHA_SOLVER}". Use: mock | 2captcha | anticaptcha | tujian`);
  }
}

export function getCaptchaSolver(): CaptchaSolverProvider {
  if (!defaultSolver) defaultSolver = createSolver();
  return defaultSolver;
}

export function resetCaptchaSolver(): void {
  defaultSolver = null;
}

export { MockCaptchaAdapter };
