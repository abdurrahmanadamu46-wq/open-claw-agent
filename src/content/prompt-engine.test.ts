/**
 * ClawCommerce Content - Prompt engine tests
 */

import { loadTemplate, render, buildRagContext, listIndustries } from './prompt-engine.js';
import type { PromptTemplate, CrawledContent } from './types.js';

describe('prompt-engine', () => {
  describe('render', () => {
    it('replaces {{variables}} in user and system prompt', () => {
      const template: PromptTemplate = {
        version: '1.0',
        industry: 'beauty',
        platform: 'xiaohongshu',
        purpose: 'full_brief',
        systemPrompt: 'You are {{role}}.',
        userPrompt: 'Generate for {{industry}} on {{platform}}.',
        requiredVars: ['role', 'industry', 'platform'],
      };
      const out = render(template, { role: 'expert', industry: 'beauty', platform: 'xiaohongshu' });
      expect(out.system).toBe('You are expert.');
      expect(out.user).toBe('Generate for beauty on xiaohongshu.');
      expect(out.variables.role).toBe('expert');
    });

    it('injects RAG context when ragContextKey and ragContext provided', () => {
      const template: PromptTemplate = {
        version: '1.0',
        industry: 'tech',
        platform: 'douyin',
        purpose: 'full_brief',
        userPrompt: 'Reference:\n{{benchmark_contents}}',
        requiredVars: ['benchmark_contents'],
        ragContextKey: 'benchmark_contents',
      };
      const contents: CrawledContent[] = [
        { id: '1', accountId: 'a1', platform: 'douyin', contentType: 'text', text: 'Hello world' },
      ];
      const out = render(template, {}, { key: 'benchmark_contents', contents });
      expect(out.user).toContain('Hello world');
    });
  });

  describe('buildRagContext', () => {
    it('joins content text with separator and limits items', () => {
      const contents: CrawledContent[] = [
        { id: '1', accountId: 'a1', platform: 'douyin', contentType: 'text', text: 'First' },
        { id: '2', accountId: 'a1', platform: 'douyin', contentType: 'text', text: 'Second' },
      ];
      const s = buildRagContext(contents, 2);
      expect(s).toContain('First');
      expect(s).toContain('Second');
      expect(s).toContain('---');
    });

    it('returns fallback when no content', () => {
      expect(buildRagContext([])).toBe('(no content)');
    });
  });

  describe('listIndustries', () => {
    it('returns array of industry ids', () => {
      const list = listIndustries();
      expect(Array.isArray(list)).toBe(true);
      expect(list.length).toBeGreaterThan(0);
      expect(list).toContain('beauty');
      expect(list).toContain('fitness');
    });
  });

  describe('loadTemplate', () => {
    it('returns null for non-existent industry', () => {
      const t = loadTemplate('nonexistent_industry_xyz', 'douyin');
      expect(t).toBeNull();
    });

    it('loads beauty default or platform template when templates dir exists', () => {
      const t = loadTemplate('beauty', 'xiaohongshu');
      if (t) {
        expect(t.industry).toBe('beauty');
        expect(t.userPrompt).toBeDefined();
        expect(t.requiredVars).toContain('benchmark_contents');
      }
    });
  });
});
