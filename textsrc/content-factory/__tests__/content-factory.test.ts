/**
 * AI 内容工厂单测 — 剧本生成 + Pipeline（Mock LLM + Mock Renderer）
 */

import { generateScript, generateScriptFromViral, DURATION_SCENE_MAP } from '../script-generator.js';
import { runContentPipeline } from '../pipeline.js';
import { resetLLMProvider } from '../../llm/adapters/index.js';
import { resetVideoRenderer } from '../renderer-adapters/index.js';

describe('content-factory', () => {
  const originalLLM = process.env.LLM_PROVIDER;

  afterEach(() => {
    resetLLMProvider();
    resetVideoRenderer();
    if (originalLLM !== undefined) process.env.LLM_PROVIDER = originalLLM;
    else delete process.env.LLM_PROVIDER;
  });

  describe('script-generator', () => {
    beforeEach(() => {
      resetLLMProvider();
      process.env.LLM_PROVIDER = 'mock';
    });

    it('DURATION_SCENE_MAP: 10→5, 15→7, 30→15', () => {
      expect(DURATION_SCENE_MAP[10]).toBe(5);
      expect(DURATION_SCENE_MAP[15]).toBe(7);
      expect(DURATION_SCENE_MAP[30]).toBe(15);
    });

    it('generateScript returns ScriptOutput with scenes array', async () => {
      const result = await generateScript(
        { sellingPoints: ['成分安全', '24小时持妆'] },
        10
      );
      expect(result.scenes).toBeDefined();
      expect(Array.isArray(result.scenes)).toBe(true);
      expect(result.scenes.length).toBeGreaterThan(0);
      expect(result.scenes.every((s) => typeof s.text === 'string')).toBe(true);
      expect(typeof result.totalDurationSeconds).toBe('number');
    });

    it('generateScriptFromViral accepts ViralDisassembleResult', async () => {
      const viral = {
        hook: '前3秒钩子',
        painPoints: ['痛点1'],
        sellingPoints: ['卖点1', '卖点2'],
      };
      const result = await generateScriptFromViral(viral, 15);
      expect(result.scenes.length).toBeGreaterThan(0);
      expect(typeof result.totalDurationSeconds).toBe('number');
    });
  });

  describe('pipeline', () => {
    beforeEach(() => {
      resetLLMProvider();
      resetVideoRenderer();
      process.env.LLM_PROVIDER = 'mock';
    });

    it('runContentPipeline returns script and renderJobId when submitRender true', async () => {
      const output = await runContentPipeline({
        durationSeconds: 10,
        sellingPoints: ['卖点A'],
        submitRender: true,
      });
      expect(output.script.scenes.length).toBeGreaterThan(0);
      expect(output.renderJobId).toBeDefined();
      expect(typeof output.renderJobId).toBe('string');
    });

    it('runContentPipeline with submitRender false has no renderJobId', async () => {
      const output = await runContentPipeline({
        durationSeconds: 15,
        sellingPoints: ['卖点B'],
        submitRender: false,
      });
      expect(output.script.scenes.length).toBeGreaterThan(0);
      expect(output.renderJobId).toBeUndefined();
    });

    it('runContentPipeline with viral uses generateScriptFromViral', async () => {
      const output = await runContentPipeline({
        durationSeconds: 10,
        sellingPoints: ['卖点'],
        viral: { hook: '钩子', painPoints: [], sellingPoints: ['卖点'] },
        submitRender: true,
      });
      expect(output.script.scenes.length).toBeGreaterThan(0);
      expect(output.renderJobId).toBeDefined();
    });

    it('runContentPipeline with removeWatermark true runs remover and returns mp4Url', async () => {
      const output = await runContentPipeline({
        durationSeconds: 10,
        sellingPoints: ['卖点'],
        submitRender: true,
        removeWatermark: true,
      });
      expect(output.script.scenes.length).toBeGreaterThan(0);
      expect(output.renderJobId).toBeDefined();
      expect(output.mp4Url).toBeDefined();
      expect(output.mp4Url).toMatch(/^https:\/\//);
    });
  });
});
