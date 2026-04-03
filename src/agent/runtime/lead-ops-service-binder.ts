import { hydrateLeadPushRuntimeEnv } from '../lead/lead-runtime-config.js';
import { pushLeadToBackend } from '../lead/lead-pusher.js';
import type { ILeadSubmissionPayload } from '../../shared/contracts.js';
import type { RuntimeLeadOpsAdapterServices } from './types.js';

function hasRequiredLeadFields(payload: Record<string, unknown>): payload is ILeadSubmissionPayload {
  return (
    typeof payload.tenant_id === 'string' &&
    typeof payload.campaign_id === 'string' &&
    typeof payload.contact_info === 'string' &&
    typeof payload.intention_score === 'number'
  );
}

export function createLeadOpsRuntimeServices(options: {
  enableReal?: boolean;
} = {}): RuntimeLeadOpsAdapterServices {
  hydrateLeadPushRuntimeEnv();
  const enableReal =
    options.enableReal ?? process.env.LOBSTER_RUNTIME_ENABLE_REAL_LEADOPS === 'true';

  if (!enableReal) {
    return {};
  }

  return {
    pushLead: async (payload) => {
      if (!hasRequiredLeadFields(payload)) {
        throw new Error('LeadOps runtime binder received invalid lead payload.');
      }

      return pushLeadToBackend(payload);
    },
  };
}
