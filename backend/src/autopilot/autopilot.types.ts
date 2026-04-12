/**
 * 全自动引擎 — Job Payload 与流转数据结构
 */

/** 所有 BullMQ Job Payload 的基础结构 */
export interface BaseJobPayload {
  tenantId: string;
  jobId?: string;
  traceId?: string;
  campaignId?: string;
  nodeId?: string;
  taskId?: string;
  replay?: {
    replayOfJobId: string;
    replayCount: number;
    replayNonce: string;
  };
}

/** DLQ（死信队列）包装层 */
export interface AutopilotDeadLetterPayload<TPayload extends BaseJobPayload = BaseJobPayload> {
  tenantId: string;
  sourceJobId: string;
  taskId?: string;
  traceId?: string;
  campaignId?: string;
  nodeId?: string;
  stage: string;
  errorCode: string;
  errorMessage: string;
  retryable: boolean;
  attemptsMade: number;
  maxAttempts: number;
  failedAt: string;
  replayedAt?: string;
  replayJobId?: string;
  originalPayload: TPayload;
}

/** DLQ 回放操作人 */
export interface DlqReplayOperator {
  operatorId: string;
  operatorName: string;
  operatorSource: 'human' | 'system' | 'api';
}

/** DLQ 回放结果 */
export type DlqReplayResult = 'success' | 'already_replayed' | 'lock_not_acquired' | 'failed';

/** DLQ 回放审计日志条目 */
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
  completedAt: string;
  operatorId: string;
  operatorName: string;
  operatorSource: string;
  result: DlqReplayResult;
  errorMessage?: string;
  tenantId: string;
}

/** 侦察队列入参：探针任务 */
export interface RadarSniffingJobPayload {
  tenantId: string;
  competitorUrl: string;
  industryKeywords: string[];
  jobId: string;
}

/** 侦察队列输出 → content_forge 入参 */
export interface ContentForgeJobPayload {
  tenantId: string;
  viralText: string;
  sourceUrl?: string;
  jobId: string;
}

/** 内容熔炼输出 → matrix_dispatch 入参 */
export interface MatrixDispatchJobPayload {
  tenantId: string;
  videoUrl: string;
  script: string;
  nodeIds: string[];
  scheduledAt?: string;
  jobId: string;
}

/** 矩阵派发输出 → lead_harvest 入参 */
export interface LeadHarvestJobPayload {
  tenantId: string;
  campaignId: string;
  publishedAt: string;
  jobId: string;
}
