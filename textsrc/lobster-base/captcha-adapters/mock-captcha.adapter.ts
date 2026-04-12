/**
 * Mock 打码 — 返回固定结果，用于单测与演示
 */

import type { CaptchaSolverProvider, CaptchaSolveOptions, CaptchaSolveResult } from '../captcha-solver.interface.js';

export class MockCaptchaAdapter implements CaptchaSolverProvider {
  readonly name = 'mock-captcha';

  async solve(_imageInput: string, _options?: CaptchaSolveOptions): Promise<CaptchaSolveResult> {
    return { text: 'MOCK_CAPTCHA_RESULT', taskId: 'mock-task-1' };
  }
}
