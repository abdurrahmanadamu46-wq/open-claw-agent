/**
 * ClawCommerce Content - Content generator tests (incl. PM v1.8 validateClipLogic)
 */

import { generateErChuangScript, validateClipLogic } from './content-generator.js';
import type { ContentGeneratorOptions, BenchmarkAccount, Clip } from './types.js';

describe('validateClipLogic', () => {
  it('passes when narration fits duration (5 chars/sec)', () => {
    const clips: Clip[] = [
      { duration_seconds: 2, narration: '十个字以内' },
      { duration_seconds: 3, narration: '十五个字以内就可以' },
    ];
    const r = validateClipLogic(clips, 5);
    expect(r.valid).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it('fails when narration too long for duration', () => {
    const clips: Clip[] = [
      { duration_seconds: 2, narration: '这一句有二十个字明显读不完会报错' },
    ];
    const r = validateClipLogic(clips, 5);
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors[0]).toMatch(/第 1 分镜/);
  });

  it('uses default 5 chars per second', () => {
    const clips: Clip[] = [{ duration_seconds: 2, narration: '十二个字左右' }];
    expect(validateClipLogic(clips).valid).toBe(true);
  });
});

describe('content-generator', () => {
  it('returns null when no template for industry/platform', async () => {
    const llm = { complete: async () => 'test' };
    const out = await generateErChuangScript(
      {
        industry: 'nonexistent_xyz',
        platform: 'douyin',
        benchmarkAccounts: [],
      },
      llm
    );
    expect(out).toBeNull();
  });

  it('returns ErChuangScript when template exists and LLM returns text', async () => {
    const llm = {
      complete: async () =>
        '这是一条测试文案。\n\n标签建议：#美妆 #护肤 #小红书',
    };
    const accounts: BenchmarkAccount[] = [
      {
        id: 'a1',
        handle: 'test',
        platform: 'xiaohongshu',
        recentContents: [
          {
            id: 'c1',
            accountId: 'a1',
            platform: 'xiaohongshu',
            contentType: 'text',
            text: '参考内容',
          },
        ],
      },
    ];
    const out = await generateErChuangScript(
      {
        industry: 'beauty',
        platform: 'xiaohongshu',
        benchmarkAccounts: accounts,
      },
      llm
    );
    expect(out).not.toBeNull();
    expect(out!.platform).toBe('xiaohongshu');
    expect(out!.copy.length).toBeGreaterThan(0);
    expect(out!.metadata).toBeDefined();
  });
});
