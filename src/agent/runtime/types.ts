import type { MissionType, RoleId } from '../commander/types.js';

export interface RuntimeQueuedStage {
  missionId: string;
  missionType: MissionType;
  stageId: string;
  ownerRole: RoleId;
  scopeId?: string;
  stageIndex: number;
  queueLane: 'live_priority' | 'guardrailed_live' | 'shadow_only' | 'structural';
  dispatchPriority: number;
  recommendedShadowWeight: number;
  recommendedLiveWeight: number;
  action: string;
  dependencyState: 'ready_now' | 'waiting_on_previous_stage';
}

export interface RuntimeQueuePlan {
  planVersion: string;
  generatedAt: string;
  sourceShadowVersion: string;
  summary: {
    missionCount: number;
    readyStageCount: number;
    totalStageCount: number;
    queueLaneBreakdown: Record<string, number>;
  };
  readyQueue: RuntimeQueuedStage[];
  fullStagePlan: RuntimeQueuedStage[];
}

export interface RuntimeDispatchTicket {
  ticketId: string;
  missionId: string;
  missionType: string;
  stageId: string;
  ownerRole: string;
  scopeId?: string;
  queueLane: RuntimeQueuedStage['queueLane'];
  dispatchPriority: number;
  executionMode: 'limited_live' | 'guardrailed_live' | 'shadow_only' | 'structural';
  bridgeTarget:
    | 'execute-campaign'
    | 'campaign-worker'
    | 'brain-shadow-runner'
    | 'lead-ops-runner'
    | 'orchestrator-control';
  readyForExecution: boolean;
  rationale: string[];
  requiredPayloadFields: string[];
  suggestedPayloadTemplate: Record<string, unknown>;
}

export interface RuntimeExecutorBridgeReport {
  bridgeVersion: string;
  generatedAt: string;
  sourceShadowVersion: string;
  sourceQueuePlanVersion: string;
  summary: {
    ticketCount: number;
    readyForExecutionCount: number;
    executionModeBreakdown: Record<string, number>;
    bridgeTargetBreakdown: Record<string, number>;
  };
  tickets: RuntimeDispatchTicket[];
}

export interface RuntimeAdapterDispatch {
  dispatchId: string;
  missionId: string;
  missionType: string;
  stageId: string;
  ownerRole: string;
  scopeId?: string;
  queueLane: RuntimeDispatchTicket['queueLane'];
  ticketId: string;
  executionMode: RuntimeDispatchTicket['executionMode'];
  bridgeTarget: RuntimeDispatchTicket['bridgeTarget'];
  dispatchStrategy:
    | 'call_execute_campaign_task'
    | 'enqueue_campaign_worker_job'
    | 'invoke_brain_shadow_runner'
    | 'invoke_lead_ops_runner'
    | 'skip_structural_stage';
  readyToApply: boolean;
  dryRunStatus: 'ready' | 'blocked' | 'structural_only';
  payloadContract: string[];
  payloadPreview: Record<string, unknown>;
  guardrails: string[];
}

export interface RuntimeWorkerAdapterReport {
  adapterVersion: string;
  generatedAt: string;
  sourceBridgeVersion: string;
  summary: {
    dispatchCount: number;
    readyCount: number;
    blockedCount: number;
    strategyBreakdown: Record<string, number>;
  };
  dispatches: RuntimeAdapterDispatch[];
}

export interface RuntimeApplyAttempt {
  applyId: string;
  dispatchId: string;
  dispatchStrategy: RuntimeAdapterDispatch['dispatchStrategy'];
  readyToApply: boolean;
  applyMode: 'dry_run' | 'live';
  status: 'planned' | 'simulated' | 'skipped' | 'blocked';
  target: RuntimeAdapterDispatch['bridgeTarget'];
  reason: string[];
  payloadPreview: Record<string, unknown>;
}

export interface RuntimeApplyRunnerReport {
  applyVersion: string;
  generatedAt: string;
  sourceAdapterVersion: string;
  summary: {
    attemptCount: number;
    simulatedCount: number;
    skippedCount: number;
    blockedCount: number;
    strategyBreakdown: Record<string, number>;
  };
  attempts: RuntimeApplyAttempt[];
}

export interface RuntimeLimitedLivePolicy {
  version: string;
  name: string;
  allowRoles: string[];
  allowRoleScopes?: Record<string, string[]>;
  allowStrategies: RuntimeAdapterDispatch['dispatchStrategy'][];
  allowExecutionModes: RuntimeDispatchTicket['executionMode'][];
  allowGuardrailedLive: boolean;
  maxLiveWeight: number;
  outputDirectory: string;
}

export interface RuntimeLimitedLiveEnvelope {
  envelopeId: string;
  dispatchId: string;
  missionId: string;
  missionType: string;
  stageId: string;
  ownerRole: string;
  scopeId?: string;
  bridgeTarget: RuntimeAdapterDispatch['bridgeTarget'];
  dispatchStrategy: RuntimeAdapterDispatch['dispatchStrategy'];
  payload: Record<string, unknown>;
  guardrails: string[];
  createdAt: string;
}

export interface RuntimeLimitedLiveDecision {
  dispatchId: string;
  ownerRole: string;
  executionMode: RuntimeDispatchTicket['executionMode'];
  action: 'queued_live' | 'denied' | 'skipped';
  rationale: string[];
  envelopePath?: string;
}

export interface RuntimeLimitedLiveReport {
  liveVersion: string;
  generatedAt: string;
  policyVersion: string;
  sourceAdapterVersion: string;
  outputDirectory: string;
  summary: {
    consideredCount: number;
    queuedCount: number;
    deniedCount: number;
    skippedCount: number;
  };
  decisions: RuntimeLimitedLiveDecision[];
}

export interface RuntimeLiveQueueConsumerPolicy {
  version: string;
  name: string;
  sourceDirectory: string;
  processedDirectory: string;
  targetQueues: Record<string, string>;
}

export interface RuntimeLiveQueueRecord {
  recordVersion: string;
  consumedAt: string;
  dispatchId: string;
  missionId: string;
  missionType: string;
  stageId: string;
  ownerRole: string;
  scopeId?: string;
  bridgeTarget: string;
  dispatchStrategy: string;
  payload: Record<string, unknown>;
  guardrails: string[];
}

export interface RuntimeLiveQueueConsumerDecision {
  dispatchId: string;
  bridgeTarget: string;
  action: 'queued' | 'denied';
  queuePath?: string;
  processedPath?: string;
  rationale: string[];
}

export interface RuntimeLiveQueueConsumerReport {
  consumerVersion: string;
  generatedAt: string;
  policyVersion: string;
  summary: {
    sourceCount: number;
    queuedCount: number;
    deniedCount: number;
    deduplicatedCount: number;
    targetBreakdown: Record<string, number>;
  };
  decisions: RuntimeLiveQueueConsumerDecision[];
}

export interface RuntimeTargetQueueConsumerPolicy {
  version: string;
  name: string;
  targetQueues: Record<string, string>;
  processedDirectories: Record<string, string>;
  resultDirectories: Record<string, string>;
}

export interface RuntimeTargetQueueConsumeDecision {
  queueRecordId: string;
  bridgeTarget: string;
  action: 'processed' | 'denied';
  handlerSource?: 'simulated' | 'injected' | 'fallback';
  processedPath?: string;
  resultPath?: string;
  rationale: string[];
}

export interface RuntimeTargetQueueConsumerReport {
  consumerVersion: string;
  generatedAt: string;
  policyVersion: string;
  handlerMode: RuntimeTargetHandlerMode;
  activeBindings: string[];
  summary: {
    recordCount: number;
    processedCount: number;
    deniedCount: number;
    injectedCount: number;
    fallbackCount: number;
    targetBreakdown: Record<string, number>;
  };
  decisions: RuntimeTargetQueueConsumeDecision[];
}

export interface RuntimeTargetHandlerInput {
  queueRecordId: string;
  bridgeTarget: string;
  scopeId?: string;
  payload: Record<string, unknown>;
  guardrails: string[];
}

export interface RuntimeTargetHandlerResult {
  status: 'simulated' | 'handled' | 'failed';
  note: string;
  payloadEcho?: Record<string, unknown>;
  handlerSource?: 'simulated' | 'injected' | 'fallback';
}

export type RuntimeTargetHandler = (
  input: RuntimeTargetHandlerInput,
) => Promise<RuntimeTargetHandlerResult>;

export type RuntimeTargetHandlerMode = 'simulated' | 'injected';

export interface RuntimeTargetHandlerServices {
  executeCampaignHandler?: RuntimeTargetHandler;
  leadOpsHandler?: RuntimeTargetHandler;
  brainShadowHandler?: RuntimeTargetHandler;
  orchestratorControlHandler?: RuntimeTargetHandler;
}

export interface RuntimeExecuteCampaignAdapterServices {
  executeCampaignTask?: (payload: Record<string, unknown>) => Promise<unknown>;
}

export interface RuntimeLeadOpsAdapterServices {
  pushLead?: (payload: Record<string, unknown>) => Promise<unknown>;
}

export interface RuntimeTargetHandlerRegistry {
  [bridgeTarget: string]: RuntimeTargetHandler | undefined;
}

export interface RuntimeFeedbackIngestReport {
  ingestVersion: string;
  generatedAt: string;
  baseTruthPath: string | null;
  outputTruthPath: string;
  summary: {
    inputRecordCount: number;
    ingestedRecordCount: number;
    mergedRecordCount: number;
    payloadExpandedCount: number;
    sourceBreakdown: Record<string, number>;
    signalBreakdown: Record<string, number>;
  };
  ingestedRecordIds: string[];
}

export interface RuntimeScopeDriftAlert {
  roleId: string;
  scopeId: string;
  severity: 'low' | 'medium' | 'high';
  alertType:
    | 'policy_violation'
    | 'stale_scope'
    | 'failure_detected'
    | 'simulated_only_scope'
    | 'no_handled_yet';
  recommendedAction: string;
  message: string;
  latestResultStatus: string | null;
  latestResultAt: string | null;
  queuedCount: number;
  handledCount: number;
  failedCount: number;
  simulatedCount: number;
}

export interface RuntimeScopeDriftAlertReport {
  alertVersion: string;
  generatedAt: string;
  policyVersion: string;
  sourceTrendVersion: string;
  summary: {
    scopeCount: number;
    alertCount: number;
    highCount: number;
    mediumCount: number;
    lowCount: number;
  };
  alerts: RuntimeScopeDriftAlert[];
}

export interface RuntimeScopeDriftAlertDeliveryDecision {
  alertKey: string;
  roleId: string;
  scopeId: string;
  alertType: RuntimeScopeDriftAlert['alertType'];
  severity: RuntimeScopeDriftAlert['severity'];
  action: 'delivered' | 'skipped_duplicate';
  inboxPath?: string;
  fingerprint: string;
}

export interface RuntimeScopeDriftAlertDeliveryReport {
  deliveryVersion: string;
  generatedAt: string;
  policyVersion: string;
  sourceAlertVersion: string;
  summary: {
    alertCount: number;
    deliveredCount: number;
    duplicateCount: number;
  };
  decisions: RuntimeScopeDriftAlertDeliveryDecision[];
}

export interface RuntimeScopeDriftAlertSinkDecision {
  alertKey: string;
  roleId: string;
  scopeId: string;
  sinkType: 'dashboard_feed' | 'webhook_outbox';
  action: 'published';
  outputPath: string;
}

export interface RuntimeScopeDriftAlertSinkReport {
  sinkVersion: string;
  generatedAt: string;
  policyVersion: string;
  sourceDeliveryVersion: string;
  summary: {
    deliveredAlertCount: number;
    publishedCount: number;
    dashboardCount: number;
    webhookOutboxCount: number;
  };
  decisions: RuntimeScopeDriftAlertSinkDecision[];
}

export interface RuntimeScopeDriftWebhookDispatchDecision {
  outboxPath: string;
  targetId: string;
  action: 'sent' | 'failed' | 'skipped_no_target';
  responseStatus?: number;
  responseBodyPreview?: string;
  error?: string;
  processedPath?: string;
  failedPath?: string;
}

export interface RuntimeScopeDriftWebhookDispatchReport {
  dispatchVersion: string;
  generatedAt: string;
  policyVersion: string;
  summary: {
    outboxCount: number;
    sentCount: number;
    failedCount: number;
    skippedCount: number;
  };
  decisions: RuntimeScopeDriftWebhookDispatchDecision[];
}
