/**
 * 统一 Pipeline 单测 — Mock LLM + Mock Renderer
 */

import { runFullPipeline } from '../full-pipeline.js';
import { resetLLMProvider } from '../llm/adapters/index.js';
import { resetVideoRenderer } from '../content-factory/renderer-adapters/index.js';

describe('full-pipeline', () => {
  beforeEach(() => {
    resetLLMProvider();
    resetVideoRenderer();
    process.env.LLM_PROVIDER = 'mock';
  });

  it('runFullPipeline without transcript returns script and renderJobId', async () => {
    const result = await runFullPipeline({
      sellingPoints: ['卖点A'],
      durationSeconds: 10,
      submitRender: true,
    });
    expect(result.script.scenes.length).toBeGreaterThan(0);
    expect(result.renderJobId).toBeDefined();
    expect(result.viral).toBeUndefined();
  });

  it('runFullPipeline with transcript returns viral and script', async () => {
    const result = await runFullPipeline({
      transcript: '这款产品太好用了，敏感肌也能用',
      sellingPoints: ['卖点B'],
      durationSeconds: 15,
      submitRender: false,
    });
    expect(result.viral).toBeDefined();
    expect(result.viral!.hook).toBeDefined();
    expect(result.script.scenes.length).toBeGreaterThan(0);
  });

  it('runFullPipeline with crawlerTask returns crawlerTaskJson', async () => {
    const result = await runFullPipeline({
      sellingPoints: ['卖点C'],
      durationSeconds: 10,
      submitRender: false,
      crawlerTask: {
        jobId: 'JOB-PIPELINE-1',
        platform: 'douyin',
        targetAccountUrl: 'https://v.douyin.com/xxx',
      },
    });
    expect(result.crawlerTaskJson).toBeDefined();
    const parsed = JSON.parse(result.crawlerTaskJson!);
    expect(parsed.jobId).toBe('JOB-PIPELINE-1');
    expect(parsed.platform).toBe('douyin');
    expect(Array.isArray(parsed.actions)).toBe(true);
  });
});
