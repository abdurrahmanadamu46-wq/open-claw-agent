/**
 * 龙虾底座骨架单测 — 不启动真实浏览器，只测纯函数与 Mock 打码
 */

import { humanLikeMousePath, getProfileDir, ensureProfileDir, DEFAULT_PROFILE_ROOT } from '../index.js';
import { getCaptchaSolver, resetCaptchaSolver } from '../captcha-adapters/index.js';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

describe('lobster-base', () => {
  describe('anti-detect', () => {
    it('humanLikeMousePath returns path from A to B with steps', () => {
      const from = { x: 0, y: 0 };
      const to = { x: 100, y: 50 };
      const points = humanLikeMousePath(from, to, 10);
      expect(points.length).toBe(11);
      expect(points[0]).toEqual({ x: expect.any(Number), y: expect.any(Number) });
      expect(points[points.length - 1].x).toBeCloseTo(100, -1);
      expect(points[points.length - 1].y).toBeCloseTo(50, -1);
    });
  });

  describe('cookie-isolation', () => {
    it('getProfileDir returns platform/account path', () => {
      const dir = getProfileDir('douyin', 'acc-001');
      expect(dir).toContain('douyin');
      expect(dir).toContain('acc-001');
    });

    it('ensureProfileDir creates directory and returns path', () => {
      const root = path.join(os.tmpdir(), 'lobster-base-test-' + Date.now());
      const dir = ensureProfileDir('xiaohongshu', 'acc-002', root);
      expect(fs.existsSync(dir)).toBe(true);
      expect(dir).toContain('xiaohongshu');
      expect(dir).toContain('acc-002');
      fs.rmSync(root, { recursive: true, force: true });
    });
  });

  describe('captcha-solver', () => {
    const original = process.env.CAPTCHA_SOLVER;

    afterEach(() => {
      resetCaptchaSolver();
      if (original !== undefined) process.env.CAPTCHA_SOLVER = original;
      else delete process.env.CAPTCHA_SOLVER;
    });

    it('getCaptchaSolver returns mock when CAPTCHA_SOLVER=mock', async () => {
      process.env.CAPTCHA_SOLVER = 'mock';
      const solver = getCaptchaSolver();
      expect(solver.name).toBe('mock-captcha');
      const result = await solver.solve('https://example.com/captcha.png');
      expect(result.text).toBeDefined();
      expect(typeof result.text).toBe('string');
    });
  });
});
