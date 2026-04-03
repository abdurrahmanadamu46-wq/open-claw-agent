import { hydrateLeadPushRuntimeEnv } from '../lead/lead-runtime-config.js';
import { pushLeadToBackend } from '../lead/lead-pusher.js';
import type {
  RuntimeLeadOpsAdapterServices,
  RuntimeTargetHandler,
  RuntimeTargetHandlerInput,
} from './types.js';

function toLeadPayload(input: RuntimeTargetHandlerInput): Record<string, unknown> | null {
  const payload = input.payload;
  const nested = payload.lead_submission;

  if (!nested || typeof nested !== 'object') {
    return null;
  }

  return nested as Record<string, unknown>;
}

export function createInjectedLeadOpsHandler(
  services: RuntimeLeadOpsAdapterServices = {},
): RuntimeTargetHandler {
  return async (input) => {
    hydrateLeadPushRuntimeEnv();
    const leadPayload = toLeadPayload(input);
    const scopeId = input.scopeId ?? 'unscoped';

    if (!leadPayload) {
      return {
        status: 'simulated',
        note: `Injected lead ops handler fallback: missing lead_submission payload for ${input.queueRecordId}`,
        payloadEcho: input.payload,
        handlerSource: 'fallback',
      };
    }

    if (services.pushLead) {
      const result = await services.pushLead(leadPayload);
      return {
        status: (result as { ok?: boolean }).ok === false ? 'failed' : 'handled',
        note: `Injected lead ops handler processed ${input.queueRecordId} (${scopeId})`,
        payloadEcho: {
          leadPayload,
          scopeId,
          result,
        },
        handlerSource: 'injected',
      };
    }

    const requiredKeys = ['tenant_id', 'campaign_id', 'contact_info', 'intention_score'];
    const hasRequiredKeys = requiredKeys.every((key) => leadPayload[key] !== undefined);

    if (
      process.env.LOBSTER_RUNTIME_ENABLE_REAL_LEADOPS === 'true' &&
      hasRequiredKeys
    ) {
      const result = await pushLeadToBackend(leadPayload as never);
      return {
        status: result.ok ? 'handled' : 'failed',
        note: `Real lead ops push attempted for ${input.queueRecordId} (${scopeId})`,
        payloadEcho: {
          leadPayload,
          scopeId,
          result,
        },
        handlerSource: 'injected',
      };
    }

    return {
      status: 'simulated',
      note: `Injected lead ops handler fallback: no real lead service bound for ${input.queueRecordId}`,
      payloadEcho: input.payload,
      handlerSource: 'fallback',
    };
  };
}
