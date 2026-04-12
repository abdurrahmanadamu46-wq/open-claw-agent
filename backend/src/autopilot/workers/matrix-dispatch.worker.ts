import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Logger } from '@nestjs/common';
import { MATRIX_DISPATCH_QUEUE, LEAD_HARVEST_QUEUE } from '../autopilot.constants';
import type { MatrixDispatchJobPayload, LeadHarvestJobPayload } from '../autopilot.types';
import { AutopilotCircuitService } from '../autopilot-circuit.service';

/**
 * 矩阵派发队列 Worker：排期下发到龙虾节点，完成后入参 lead_harvest
 */
@Processor(MATRIX_DISPATCH_QUEUE)
export class MatrixDispatchWorker extends WorkerHost {
  private readonly logger = new Logger(MatrixDispatchWorker.name);

  constructor(
    @InjectQueue(LEAD_HARVEST_QUEUE) private readonly leadHarvestQueue: Queue,
    private readonly circuit: AutopilotCircuitService,
  ) {
    super();
  }

  async process(job: Job<MatrixDispatchJobPayload>): Promise<LeadHarvestJobPayload | void> {
    const { tenantId, videoUrl, script, nodeIds, scheduledAt, jobId } = job.data;
    this.logger.log(`[MatrixDispatch] Processing job ${job.id} tenant=${tenantId} nodes=${nodeIds.length}`);

    try {
      await this.dispatchToNodes(nodeIds, { videoUrl, script, scheduledAt });

      this.circuit.recordSuccess(MATRIX_DISPATCH_QUEUE);

      const campaignId = `CAMP_${Date.now()}`;
      const nextPayload: LeadHarvestJobPayload = {
        tenantId,
        campaignId,
        publishedAt: new Date().toISOString(),
        jobId,
      };
      await this.leadHarvestQueue.add('harvest', nextPayload, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
      });
      this.logger.log(`[MatrixDispatch] Job ${job.id} done, enqueued lead_harvest`);
      return nextPayload;
    } catch (err) {
      this.logger.warn(`[MatrixDispatch] Job ${job.id} failed`, err);
      this.circuit.recordFailure(MATRIX_DISPATCH_QUEUE);
      throw err;
    }
  }

  private async dispatchToNodes(
    nodeIds: string[],
    payload: { videoUrl: string; script: string; scheduledAt?: string },
  ): Promise<void> {
    // 实际：MQTT / 内部 API 下发到各节点
    await new Promise((r) => setTimeout(r, 300));
    this.logger.log(`[MatrixDispatch] Dispatched to ${nodeIds.join(', ')}: ${payload.videoUrl}`);
  }
}
