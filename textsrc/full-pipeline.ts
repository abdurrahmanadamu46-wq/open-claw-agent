/**
 * ClawCommerce 统一 Pipeline：雷达 → 工厂 → 产出
 * 串联：转录/文案 → 爆款拆解 → 剧本生成 → 视频渲染；可选打包爬虫任务供下发龙虾
 */

import { disassembleViralContent } from './radar-brain/content-disassembler.js';
import type { ViralDisassembleResult } from './radar-brain/content-disassembler.js';
import { buildCompetitorMonitorTask, serializeCrawlerTask } from './radar-brain/crawler-task.js';
import type { CrawlerPlatform } from './radar-brain/crawler-task.js';
import { runContentPipeline } from './content-factory/pipeline.js';
import type { ScriptOutput, ScriptDuration } from './content-factory/script-generator.js';

export interface FullPipelineInput {
  /** 可选：视频/音频转录文字或文案，有则先做爆款拆解再融梗生成剧本 */
  transcript?: string;
  /** 主推卖点（必填） */
  sellingPoints: string[];
  /** 视频时长：10 | 15 | 30 秒 */
  durationSeconds: ScriptDuration;
  /** 可选：产品文案补充 */
  productCopy?: string;
  /** 是否提交视频渲染（默认 true） */
  submitRender?: boolean;
  /** 合规选项：勾选后对生成的视频执行去水印，产出无水印版本 */
  removeWatermark?: boolean;
  /** 可选：同时打包一条「监控对标账号」爬虫任务，供总控下发给龙虾节点 */
  crawlerTask?: {
    jobId: string;
    campaignId?: string;
    platform: CrawlerPlatform;
    targetAccountUrl: string;
  };
}

export interface FullPipelineOutput {
  /** 若有 transcript，则产出爆款拆解 */
  viral?: ViralDisassembleResult;
  /** 剧本（分镜列表） */
  script: ScriptOutput;
  /** 视频渲染任务 ID */
  renderJobId?: string;
  /** 渲染完成后的 MP4 链接（mock 或同步时可能有） */
  mp4Url?: string;
  /** 若请求了 crawlerTask，则序列化后的 JSON，可经 WebSocket/Redis 下发给龙虾 */
  crawlerTaskJson?: string;
}

/**
 * 全流程：转录 → 拆解 → 剧本 → 渲染；可选打包爬虫任务
 */
export async function runFullPipeline(input: FullPipelineInput): Promise<FullPipelineOutput> {
  let viral: ViralDisassembleResult | undefined;
  if (input.transcript?.trim()) {
    viral = await disassembleViralContent(input.transcript);
  }

  const contentResult = await runContentPipeline({
    durationSeconds: input.durationSeconds,
    sellingPoints: input.sellingPoints,
    viral,
    productCopy: input.productCopy,
    submitRender: input.submitRender !== false,
    removeWatermark: input.removeWatermark === true,
  });

  const output: FullPipelineOutput = {
    script: contentResult.script,
    renderJobId: contentResult.renderJobId,
    mp4Url: contentResult.mp4Url,
  };
  if (viral) output.viral = viral;

  if (input.crawlerTask) {
    const task = buildCompetitorMonitorTask({
      jobId: input.crawlerTask.jobId,
      campaignId: input.crawlerTask.campaignId,
      platform: input.crawlerTask.platform,
      targetAccountUrl: input.crawlerTask.targetAccountUrl,
    });
    output.crawlerTaskJson = serializeCrawlerTask(task);
  }

  return output;
}
