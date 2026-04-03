/**
 * 雷达大脑骨架单测 — crawler-task 序列化 + content-disassembler（Mock LLM）
 */

import {
  buildCompetitorMonitorTask,
  serializeCrawlerTask,
  deserializeCrawlerTask,
} from '../crawler-task.js';
import { disassembleViralContent } from '../content-disassembler.js';
import { getLLMProvider, resetLLMProvider } from '../../llm/adapters/index.js';

describe('radar-brain', () => {
  const originalLLM = process.env.LLM_PROVIDER;

  afterEach(() => {
    resetLLMProvider();
    if (originalLLM !== undefined) process.env.LLM_PROVIDER = originalLLM;
    else delete process.env.LLM_PROVIDER;
  });

  describe('crawler-task', () => {
    it('buildCompetitorMonitorTask produces valid task with actions', () => {
      const task = buildCompetitorMonitorTask({
        jobId: 'JOB-001',
        campaignId: 'CAMP-01',
        platform: 'douyin',
        targetAccountUrl: 'https://v.douyin.com/xxx',
      });
      expect(task.jobId).toBe('JOB-001');
      expect(task.platform).toBe('douyin');
      expect(task.actions.length).toBeGreaterThan(0);
      expect(task.actions.some((a) => a.type === 'silent_scroll')).toBe(true);
      expect(task.actions.some((a) => a.type === 'grab_metrics')).toBe(true);
    });

    it('serializeCrawlerTask / deserializeCrawlerTask roundtrip', () => {
      const task = buildCompetitorMonitorTask({
        jobId: 'JOB-002',
        platform: 'xiaohongshu',
        targetAccountUrl: 'https://www.xiaohongshu.com/user/xxx',
      });
      const json = serializeCrawlerTask(task);
      const restored = deserializeCrawlerTask(json);
      expect(restored.jobId).toBe(task.jobId);
      expect(restored.platform).toBe(task.platform);
      expect(restored.actions.length).toBe(task.actions.length);
    });

    it('deserializeCrawlerTask throws on invalid payload', () => {
      expect(() => deserializeCrawlerTask('{}')).toThrow('Invalid CompetitorMonitorTask');
      expect(() => deserializeCrawlerTask('{"jobId":"x","platform":"douyin"}')).toThrow();
    });
  });

  describe('content-disassembler', () => {
    it('disassembleViralContent returns ViralDisassembleResult with mock LLM', async () => {
      process.env.LLM_PROVIDER = 'mock';
      const transcript = '这款面膜太好用了，敏感肌也能用...';
      const result = await disassembleViralContent(transcript);
      expect(result).toHaveProperty('hook');
      expect(result).toHaveProperty('painPoints');
      expect(result).toHaveProperty('sellingPoints');
      expect(Array.isArray(result.painPoints)).toBe(true);
      expect(Array.isArray(result.sellingPoints)).toBe(true);
    });
  });
});
