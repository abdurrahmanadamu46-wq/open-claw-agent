import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Logger } from '@nestjs/common';
import {
  RADAR_SNIFFING_QUEUE,
  CONTENT_FORGE_QUEUE,
} from '../autopilot.constants';
import type { RadarSniffingJobPayload } from '../autopilot.types';
import type { ContentForgeJobPayload } from '../autopilot.types';
import { AutopilotCircuitService } from '../autopilot-circuit.service';

/**
 * 侦察队列 Worker：探针抓取爆款文本，完成后自动入参 content_forge
 */
@Processor(RADAR_SNIFFING_QUEUE)
export class RadarSniffingWorker extends WorkerHost {
  private readonly logger = new Logger(RadarSniffingWorker.name);

  constructor(
    @InjectQueue(CONTENT_FORGE_QUEUE) private readonly contentForgeQueue: Queue,
    private readonly circuit: AutopilotCircuitService,
  ) {
    super();
  }

  async process(job: Job<RadarSniffingJobPayload>): Promise<ContentForgeJobPayload | void> {
    const { tenantId, competitorUrl, industryKeywords, jobId } = job.data;
    this.logger.log(`[Radar] Processing job ${job.id} tenant=${tenantId} url=${competitorUrl}`);

    try {
      // 模拟/实际：爬取对标 URL + 行业词，得到爆款文本
      const viralText = await this.sniffViralContent(competitorUrl, industryKeywords);

      this.circuit.recordSuccess(RADAR_SNIFFING_QUEUE);

      const nextPayload: ContentForgeJobPayload = {
        tenantId,
        viralText,
        sourceUrl: competitorUrl,
        jobId,
      };
      await this.contentForgeQueue.add('forge', nextPayload, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
      });
      this.logger.log(`[Radar] Job ${job.id} done, enqueued content_forge`);
      return nextPayload;
    } catch (err) {
      this.logger.warn(`[Radar] Job ${job.id} failed`, err);
      this.circuit.recordFailure(RADAR_SNIFFING_QUEUE);
      throw err;
    }
  }

  private async sniffViralContent(url: string, keywords: string[]): Promise<string> {
    // 实际实现：爬虫 / API 抓取竞品页，提取爆款文案
    await new Promise((r) => setTimeout(r, 500));
    return `[爆款文本] 来源: ${url}，关键词: ${keywords.join('、')}。这是一段模拟抓取的爆款文案，用于驱动内容熔炼队列。`;
  }
}
