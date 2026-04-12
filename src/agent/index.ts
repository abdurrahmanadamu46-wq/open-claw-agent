/**
 * ClawCommerce Agent - Public API
 * @module agent
 */

export { NodeManager } from './node-manager.js';
export { NodePool } from './node-pool.js';
export { HealthMonitor } from './health-monitor.js';
export { PhonePool, smsActivateToPhoneAdapter } from './phone-pool.js';
export { createLogger, createMockLogger } from './logger.js';
export { getNodesStatusHandler, WS_PUSH_DOC } from './dashboard-api.js';
export { createCampaignWorker, campaignConfigFromPayload } from './workers/campaign-worker.js';
export { executeCampaignTask } from './execute-campaign.js';
export type { ExecuteCampaignResult, ExecuteCampaignOptions } from './execute-campaign.js';
export { withRetryAdapter, createSmsActivateAdapterStub } from './sms-activate-adapter.js';
export type { ISmsActivateAdapter, SmsActivateApiConfig } from './sms-activate-adapter.js';
export { pushLeadToBackend } from './lead/lead-pusher.js';
export type { LeadPushPayload, LeadPushResult } from './lead/lead-pusher.js';
export { interpret, runPath } from './behavior-runtime.js';
export type { BehaviorPath, BehaviorStep, BehaviorAction, InterpretedStep } from './behavior-runtime.js';
export { reportBehaviorLog } from './behavior-reporter.js';
export type { BehaviorLogPayload, BehaviorLogReportResult } from './behavior-reporter.js';
export * from './types.js';
export { NodeStatusEnum } from '../shared/contracts.js';
export type { ICampaignConfig, CampaignJobData, NodeHeartbeatPayload, ILeadSubmissionPayload } from '../shared/contracts.js';

// ── Industry Preview API (runtime-owned, stable handler-level entry) ──
export { getIndustryCatalogHandler, compileIndustryWorkflowHandler } from './industry-preview-api.js';

// ── Lead Runtime Config (decoupled from lead-pusher) ──
export { resolveLeadPushRuntimeConfig } from './lead/lead-runtime-config.js';

// ── Commander Decision Engine ──
export { resolveCommanderDecision } from './commander/engine.js';
