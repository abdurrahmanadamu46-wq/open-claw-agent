import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { LEAD_HARVEST_QUEUE } from '../autopilot.constants';
import type { LeadHarvestJobPayload } from '../autopilot.types';
import { AutopilotCircuitService } from '../autopilot-circuit.service';

/**
 * 线索收割队列 Worker：闭环最后一环，收割评论/私信线索并推送 Webhook
 */
@Processor(LEAD_HARVEST_QUEUE)
export class LeadHarvestWorker extends WorkerHost {
  private readonly logger = new Logger(LeadHarvestWorker.name);

  constructor(private readonly circuit: AutopilotCircuitService) {
    super();
  }

  async process(job: Job<LeadHarvestJobPayload>): Promise<void> {
    const { tenantId, campaignId, publishedAt, jobId } = job.data;
    this.logger.log(`[LeadHarvest] Processing job ${job.id} tenant=${tenantId} campaign=${campaignId}`);

    try {
      await this.harvestLeads(tenantId, campaignId, publishedAt);
      this.circuit.recordSuccess(LEAD_HARVEST_QUEUE);
      this.logger.log(`[LeadHarvest] Job ${job.id} done`);
    } catch (err) {
      this.logger.warn(`[LeadHarvest] Job ${job.id} failed`, err);
      this.circuit.recordFailure(LEAD_HARVEST_QUEUE);
      throw err;
    }
  }

  private async harvestLeads(
    tenantId: string,
    campaignId: string,
    publishedAt: string,
  ): Promise<void> {
    // 实际：轮询/订阅各平台评论与私信，高意向线索入 Webhook 队列
    await new Promise((r) => setTimeout(r, 200));
    this.logger.log(`[LeadHarvest] Harvested campaign ${campaignId} at ${publishedAt}`);
  }
}
