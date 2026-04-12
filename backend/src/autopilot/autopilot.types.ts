/**
 * 全自动引擎 — Job Payload 与流转数据结构
 */

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
