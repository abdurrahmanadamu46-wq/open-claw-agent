import { createInjectedExecuteCampaignHandler } from './execute-campaign-adapter.js';
import { createExecuteCampaignRuntimeServices } from './execute-campaign-service-binder.js';
import { createInjectedLeadOpsHandler } from './lead-ops-adapter.js';
import { createLeadOpsRuntimeServices } from './lead-ops-service-binder.js';
import { simulateLeadOpsDispatch } from './lead-ops-runner.js';
import type {
  RuntimeTargetHandlerMode,
  RuntimeTargetHandlerServices,
  RuntimeTargetHandler,
  RuntimeTargetHandlerInput,
  RuntimeTargetHandlerRegistry,
} from './types.js';

const simulatedExecuteCampaignHandler: RuntimeTargetHandler = async (input) => ({
  status: 'simulated',
  note: `Execute campaign handler prepared for ${input.queueRecordId}`,
  payloadEcho: input.payload,
});

const simulatedLeadOpsHandler: RuntimeTargetHandler = async (input) => {
  const result = await simulateLeadOpsDispatch({
    dispatchId: input.queueRecordId,
    payloadPreview: input.payload,
  });

  return {
    status: result.status,
    note: result.note,
    payloadEcho: input.payload,
  };
};

const simulatedBrainShadowHandler: RuntimeTargetHandler = async (input) => ({
  status: 'simulated',
  note: `Brain shadow handler prepared for ${input.queueRecordId}`,
  payloadEcho: input.payload,
});

const simulatedOrchestratorHandler: RuntimeTargetHandler = async (input) => ({
  status: 'simulated',
  note: `Orchestrator control handler prepared for ${input.queueRecordId}`,
  payloadEcho: input.payload,
});

export function createDefaultTargetHandlerRegistry(): RuntimeTargetHandlerRegistry {
  return {
    'lead-ops-runner': simulatedLeadOpsHandler,
    'execute-campaign': simulatedExecuteCampaignHandler,
    'brain-shadow-runner': simulatedBrainShadowHandler,
    'orchestrator-control': simulatedOrchestratorHandler,
  };
}

export function createTargetHandlerRegistry(
  overrides: Partial<RuntimeTargetHandlerRegistry> = {},
): RuntimeTargetHandlerRegistry {
  return {
    ...createDefaultTargetHandlerRegistry(),
    ...overrides,
  };
}

export function createTargetHandlerRegistryWithMode(options: {
  mode?: RuntimeTargetHandlerMode;
  binds?: string[];
  services?: RuntimeTargetHandlerServices;
  overrides?: Partial<RuntimeTargetHandlerRegistry>;
} = {}): RuntimeTargetHandlerRegistry {
  const mode = options.mode ?? 'simulated';
  const binds = options.binds ?? [];
  const defaults = createDefaultTargetHandlerRegistry();

  if (mode === 'simulated') {
    return {
      ...defaults,
      ...(options.overrides ?? {}),
    };
  }

  const services = options.services ?? {};
  const leadOpsServices = createLeadOpsRuntimeServices({
    enableReal: mode === 'injected' && binds.includes('lead-ops')
      ? process.env.LOBSTER_RUNTIME_ENABLE_REAL_LEADOPS === 'true'
      : false,
  });
  const executeCampaignServices = createExecuteCampaignRuntimeServices({
    enableReal: mode === 'injected' && binds.includes('execute-campaign')
      ? process.env.LOBSTER_RUNTIME_ENABLE_REAL_EXECUTE_CAMPAIGN === 'true'
      : false,
    executeCampaignTask: services.executeCampaignTask,
  });

  return {
    'lead-ops-runner':
      services.leadOpsHandler ??
      createInjectedLeadOpsHandler({
        ...leadOpsServices,
      }),
    'execute-campaign':
      services.executeCampaignHandler ??
      createInjectedExecuteCampaignHandler({
        ...executeCampaignServices,
      }),
    'brain-shadow-runner': services.brainShadowHandler ?? defaults['brain-shadow-runner'],
    'orchestrator-control':
      services.orchestratorControlHandler ?? defaults['orchestrator-control'],
    ...(options.overrides ?? {}),
  };
}

export function toTargetHandlerInput(
  queueRecordId: string,
  bridgeTarget: string,
  scopeId: string | undefined,
  payload: Record<string, unknown>,
  guardrails: string[],
): RuntimeTargetHandlerInput {
  return {
    queueRecordId,
    bridgeTarget,
    scopeId,
    payload,
    guardrails,
  };
}
