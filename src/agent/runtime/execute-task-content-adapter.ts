import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { ICampaignConfig } from '../../shared/contracts.js';
import { createLogger } from '../logger.js';
import {
  BrowserOrchestrator,
  generateErChuangScript,
  generateScriptByPacing,
  runXiaohongshuPost,
  type BenchmarkAccount,
  type ErChuangScript,
  type PlatformId,
} from '../../content/index.js';

const logger = createLogger('execute-task-content-adapter');
const ARTIFACT_DIR = 'F:\\openclaw-agent\\run\\execute-campaign-artifacts';

interface RuntimeContentExecutionReport {
  adapterVersion: string;
  generatedAt: string;
  nodeId: string;
  campaignId: string;
  tenantId: string;
  platform: PlatformId;
  industry: string;
  benchmarkCount: number;
  script: ErChuangScript | null;
  sceneCount: number;
  postResult: {
    ok: boolean;
    screenshotPath?: string;
    error?: string;
  };
  artifactPath: string;
}

interface ContentLLMAdapter {
  complete(options: { system?: string; user: string; model?: string }): Promise<string>;
}

function ensureArtifactDir(): void {
  if (!existsSync(ARTIFACT_DIR)) {
    mkdirSync(ARTIFACT_DIR, { recursive: true });
  }
}

function resolveContentPlatform(config: ICampaignConfig): PlatformId {
  const hint = (
    process.env.LOBSTER_RUNTIME_CONTENT_PLATFORM ??
    (config.industry_template_id.includes('douyin') ? 'douyin' : 'xiaohongshu')
  ).toLowerCase();

  if (hint === 'douyin' || hint === 'xiaohongshu' || hint === 'kuaishou') {
    return hint;
  }

  return 'xiaohongshu';
}

function resolveContentIndustry(config: ICampaignConfig): string {
  const source = config.industry_template_id.toLowerCase();

  if (source.includes('fitness')) return 'fitness';
  if (source.includes('beauty')) return 'beauty';
  if (source.includes('education')) return 'education';
  if (source.includes('health')) return 'health';

  return 'beauty';
}

function buildBenchmarkAccounts(config: ICampaignConfig, platform: PlatformId): BenchmarkAccount[] {
  return config.target_urls.map((url, index) => ({
    id: `benchmark_${index + 1}`,
    handle: `handle_${index + 1}`,
    platform,
    recentContents: [
      {
        id: `content_${index + 1}`,
        accountId: `benchmark_${index + 1}`,
        platform,
        contentType: 'video',
        text: `对标内容样本 ${index + 1}: ${url}`,
        mediaUrls: [url],
        publishedAt: new Date().toISOString(),
        engagement: {
          likes: 100 + index * 10,
          comments: 12 + index,
          shares: 5 + index,
        },
      },
    ],
  }));
}

function createRuntimeContentLLM(platform: PlatformId): ContentLLMAdapter {
  return {
    async complete(options) {
      const normalized = `${options.system ?? ''}\n${options.user}`.toLowerCase();

      if (normalized.includes('json') && normalized.includes('spoken_text')) {
        return JSON.stringify([
          {
            spoken_text: '先把真实问题讲清楚，再给客户一个可执行的下一步。',
            visual_prompt: '门店实景特写，字幕突出真实问题与下一步动作',
            duration_estimate: 2,
          },
          {
            spoken_text: '我们不用夸张承诺，用真实案例和流程把信任建立起来。',
            visual_prompt: '展示案例截图、流程图和对话框证据元素',
            duration_estimate: 3,
          },
          {
            spoken_text: '看完如果你也想跑通这条链路，直接私信拿方案。',
            visual_prompt: '人物正面镜头，结尾出现私信引导和品牌标识',
            duration_estimate: 2,
          },
        ]);
      }

      if (platform === 'xiaohongshu') {
        return [
          '很多内容不是没人看，而是没有把信任和线索承接接起来。',
          '把真实案例、流程和可验证细节讲出来，客户更愿意继续聊。',
          '想要一套更稳的获客打法，可以直接私信聊聊。',
          '标签建议：#本地商家增长 #内容获客 #线索转化',
        ].join('\n');
      }

      return [
        '短视频不是只追求热度，更重要的是让真正有意向的人愿意留下来。',
        '先讲痛点，再给证据，最后给明确动作，转化会更稳。',
        '#本地增长 #短视频获客 #经营提效',
      ].join('\n');
    },
  };
}

export function createRuntimeContentExecuteTask() {
  return async (params: { nodeId: string; config: ICampaignConfig }): Promise<RuntimeContentExecutionReport> => {
    const { nodeId, config } = params;
    const platform = resolveContentPlatform(config);
    const industry = resolveContentIndustry(config);
    const benchmarkAccounts = buildBenchmarkAccounts(config, platform);
    const llm = createRuntimeContentLLM(platform);

    const script = await generateErChuangScript(
      {
        industry,
        platform,
        benchmarkAccounts,
      },
      llm,
    );

    const scenes = await generateScriptByPacing(
      '15秒故事带货',
      {
        sellingPoints: ['真实案例', '线索承接', '更稳的成交推进'],
        hook: '为什么很多商家内容做了却没有线索？',
        painPoints: ['内容和成交脱节', '客户看完没有下一步'],
        productCopy: script?.copy,
      },
      llm,
    );

    const orchestrator = new BrowserOrchestrator({
      platform,
      antiDetection: {
        defaultUserAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      },
    });

    ensureArtifactDir();

    let postResult: { ok: boolean; screenshotPath?: string; error?: string };
    if (platform === 'xiaohongshu' && script) {
      postResult = await runXiaohongshuPost({
        script,
        orchestrator,
      });
    } else {
      const screenshotPath = path.join(
        ARTIFACT_DIR,
        `${config.campaign_id}_${Date.now()}_${platform}_preview.png`,
      );
      const screenshot = await orchestrator.screenshot(screenshotPath);
      postResult = {
        ok: screenshot.ok,
        screenshotPath: screenshot.screenshotPath,
        error: screenshot.error,
      };
    }

    const artifactPath = path.join(ARTIFACT_DIR, `${config.campaign_id}.json`);
    const report: RuntimeContentExecutionReport = {
      adapterVersion: 'lobster.execute-task-content-adapter.v0.1',
      generatedAt: new Date().toISOString(),
      nodeId,
      campaignId: config.campaign_id,
      tenantId: config.tenant_id,
      platform,
      industry,
      benchmarkCount: benchmarkAccounts.length,
      script,
      sceneCount: scenes.length,
      postResult,
      artifactPath,
    };

    writeFileSync(
      artifactPath,
      JSON.stringify(
        {
          ...report,
          scenes,
          benchmarkAccounts,
        },
        null,
        2,
      ),
    );

    logger.info('Runtime content execute task completed', {
      campaignId: config.campaign_id,
      nodeId,
      platform,
      artifactPath,
    });

    return report;
  };
}
