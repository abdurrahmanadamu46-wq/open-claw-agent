import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { JobState, Queue } from 'bullmq';
import type { BaseJobPayload } from './autopilot.types';
import {
  AUTOPILOT_QUEUES,
  CONTENT_FORGE_QUEUE,
  LEAD_HARVEST_QUEUE,
  MATRIX_DISPATCH_QUEUE,
  RADAR_SNIFFING_QUEUE,
} from './autopilot.constants';
import { resolveTaskId } from './autopilot-task-id';
import { AutopilotTaskStateService } from './autopilot-task-state.service';

const CANCELLABLE_STATES: JobState[] = ['waiting', 'delayed', 'prioritized', 'waiting-children'];
const CANCEL_SCAN_LIMIT = 5000;

@Injectable()
export class AutopilotTaskControlService {
  private readonly logger = new Logger(AutopilotTaskControlService.name);

  constructor(
    @InjectQueue(RADAR_SNIFFING_QUEUE) private readonly radarQueue: Queue,
    @InjectQueue(CONTENT_FORGE_QUEUE) private readonly contentQueue: Queue,
    @InjectQueue(MATRIX_DISPATCH_QUEUE) private readonly dispatchQueue: Queue,
    @InjectQueue(LEAD_HARVEST_QUEUE) private readonly harvestQueue: Queue,
    private readonly taskStateService: AutopilotTaskStateService,
  ) {}

  async cancelTask(input: {
    taskId: string;
    traceId?: string;
    stage: string;
    tenantId: string;
    sourceQueue: string;
    campaignId?: string;
    reason?: string;
    operatorId?: string;
  }): Promise<{ removedJobs: number; inspectedJobs: number }> {
    if (!AUTOPILOT_QUEUES.includes(input.sourceQueue as (typeof AUTOPILOT_QUEUES)[number])) {
      throw new Error(`Unsupported source queue for cancel: ${input.sourceQueue}`);
    }
    const queue = this.getSourceQueue(input.sourceQueue);
    const jobs = await queue.getJobs(CANCELLABLE_STATES, 0, CANCEL_SCAN_LIMIT - 1, true);
    let removedJobs = 0;

    for (const job of jobs) {
      const payload = job.data as BaseJobPayload & { tenantId?: string };
      if ((payload.tenantId ?? '') !== input.tenantId) {
        continue;
      }
      const jobTaskId = resolveTaskId(payload);
      if (jobTaskId !== input.taskId) {
        continue;
      }
      try {
        await job.remove();
        removedJobs += 1;
      } catch (error) {
        this.logger.warn(
          `[CancelTask] Failed to remove job id=${job.id} queue=${input.sourceQueue}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    if (removedJobs === 0) {
      this.logger.warn(
        `[CancelTask] No pending jobs removed taskId=${input.taskId} tenant=${input.tenantId} queue=${input.sourceQueue}`,
      );
    }

    await this.taskStateService.markCanceled({
      taskId: input.taskId,
      traceId: input.traceId,
      stage: input.stage,
      tenantId: input.tenantId,
      campaignId: input.campaignId,
      sourceQueue: input.sourceQueue,
      nodeId: 'cloud',
      errorCode: 'MANUAL_CANCELED',
      errorMessage: input.reason || 'Canceled by operator',
      meta: {
        manual: true,
        removedJobs,
        inspectedJobs: jobs.length,
        operatorId: input.operatorId,
      },
    });

    return { removedJobs, inspectedJobs: jobs.length };
  }

  assertTenantScope(tenantScope: string, targetTenantId?: string): string {
    const normalizedScope = tenantScope.trim();
    const normalizedTarget = targetTenantId?.trim();
    if (!normalizedScope) {
      throw new ForbiddenException('Tenant scope is required');
    }
    if (normalizedTarget && normalizedScope !== normalizedTarget) {
      throw new ForbiddenException('Cross-tenant cancel is forbidden');
    }
    return normalizedScope;
  }

  private getSourceQueue(sourceQueue: string): Queue {
    switch (sourceQueue) {
      case RADAR_SNIFFING_QUEUE:
        return this.radarQueue;
      case CONTENT_FORGE_QUEUE:
        return this.contentQueue;
      case MATRIX_DISPATCH_QUEUE:
        return this.dispatchQueue;
      case LEAD_HARVEST_QUEUE:
        return this.harvestQueue;
      default:
        return this.dispatchQueue;
    }
  }
}
