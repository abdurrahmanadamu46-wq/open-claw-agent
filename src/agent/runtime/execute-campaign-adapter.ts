import type { ICampaignConfig } from '../../shared/contracts.js';
import type {
  RuntimeExecuteCampaignAdapterServices,
  RuntimeTargetHandler,
  RuntimeTargetHandlerInput,
} from './types.js';

const REAL_EXECUTE_SCOPES = new Set(['internal_execute']);

function toCampaignPayload(input: RuntimeTargetHandlerInput): ICampaignConfig | null {
  const payload = input.payload as Record<string, unknown>;

  if (
    typeof payload.campaign_id !== 'string' ||
    typeof payload.tenant_id !== 'string' ||
    typeof payload.industry_template_id !== 'string' ||
    !Array.isArray(payload.target_urls) ||
    !Array.isArray(payload.bind_accounts)
  ) {
    return null;
  }

  return payload as unknown as ICampaignConfig;
}

export function createInjectedExecuteCampaignHandler(
  services: RuntimeExecuteCampaignAdapterServices = {},
): RuntimeTargetHandler {
  return async (input) => {
    const campaignPayload = toCampaignPayload(input);
    const scopeId = input.scopeId ?? 'unscoped';

    if (!campaignPayload) {
      return {
        status: 'simulated',
        note: `Injected execute-campaign handler fallback: invalid campaign payload for ${input.queueRecordId}`,
        payloadEcho: input.payload,
        handlerSource: 'fallback',
      };
    }

    if (input.scopeId && !REAL_EXECUTE_SCOPES.has(input.scopeId)) {
      return {
        status: 'simulated',
        note: `Injected execute-campaign handler blocked by scope policy for ${input.queueRecordId} (${scopeId})`,
        payloadEcho: {
          campaignPayload,
          scopeId,
        },
        handlerSource: 'fallback',
      };
    }

    if (services.executeCampaignTask) {
      const result = await services.executeCampaignTask(campaignPayload as unknown as Record<string, unknown>);
      return {
        status: (result as { ok?: boolean }).ok === false ? 'failed' : 'handled',
        note: `Injected execute-campaign handler processed ${input.queueRecordId} (${scopeId})`,
        payloadEcho: {
          campaignPayload,
          scopeId,
          result,
        },
        handlerSource: 'injected',
      };
    }

    return {
      status: 'simulated',
      note: `Injected execute-campaign handler fallback: no real executeCampaignTask bound for ${input.queueRecordId} (${scopeId})`,
      payloadEcho: {
        campaignPayload,
        scopeId,
      },
      handlerSource: 'fallback',
    };
  };
}
