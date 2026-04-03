/**
 * Autopilot job payload definitions and pipeline contracts.
 */

export interface ReplayMeta {
  replayOfJobId?: string;
  replayCount?: number;
  replayNonce?: string;
}

export interface DlqReplayOperator {
  operatorId: string;
  operatorName?: string;
  operatorSource?: string;
}

export type DlqReplayResult = 'success' | 'failed' | 'already_replayed' | 'lock_not_acquired';

export interface DlqReplayAuditLog {
  auditId: string;
  sourceQueue: string;
  dlqJobId: string;
  sourceJobId?: string;
  taskId?: string;
  stage?: string;
  traceId?: string;
  replayJobId?: string;
  replayCount?: number;
  requestedAt: string;
  completedAt?: string;
  operatorId: string;
  operatorName?: string;
  operatorSource?: string;
  result: DlqReplayResult;
  errorMessage?: string;
  tenantId?: string;
}

export interface BaseJobPayload {
  jobId: string;
  traceId: string;
  replay?: ReplayMeta;
}

export interface RadarSniffingJobPayload extends BaseJobPayload {
  tenantId: string;
  competitorUrl: string;
  industryKeywords: string[];
}

export interface ContentForgeJobPayload extends BaseJobPayload {
  tenantId: string;
  viralText: string;
  sourceUrl?: string;
}

export interface MatrixDispatchJobPayload extends BaseJobPayload {
  tenantId: string;
  videoUrl: string;
  script: string;
  nodeIds: string[];
  scheduledAt?: string;
}

export interface LeadHarvestJobPayload extends BaseJobPayload {
  tenantId: string;
  campaignId: string;
  publishedAt: string;
}

export interface AutopilotDeadLetterPayload<TPayload extends BaseJobPayload = BaseJobPayload> {
  sourceQueue: string;
  sourceJobId: string;
  tenantId: string;
  traceId: string;
  campaignId?: string;
  taskId: string;
  nodeId: string;
  stage: string;
  errorCode: string;
  errorMessage: string;
  retryable: boolean;
  attemptsMade: number;
  maxAttempts: number;
  originalPayload: TPayload;
  failedAt: string;
  replayedAt?: string;
  replayJobId?: string;
}
