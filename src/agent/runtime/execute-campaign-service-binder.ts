import type { ICampaignConfig } from '../../shared/contracts.js';
import type { RuntimeExecuteCampaignAdapterServices } from './types.js';
import { runExecuteCampaignWithRuntime } from './execute-campaign-runtime.js';
import { createRuntimeContentExecuteTask } from './execute-task-content-adapter.js';

export function createExecuteCampaignRuntimeServices(options: {
  enableReal?: boolean;
  executeCampaignTask?: (payload: Record<string, unknown>) => Promise<unknown>;
  ensureNode?: boolean;
} = {}): RuntimeExecuteCampaignAdapterServices {
  const enableReal =
    options.enableReal ?? process.env.LOBSTER_RUNTIME_ENABLE_REAL_EXECUTE_CAMPAIGN === 'true';

  if (!enableReal) {
    return {};
  }

  if (options.executeCampaignTask) {
    return {
      executeCampaignTask: options.executeCampaignTask,
    };
  }

  return {
    executeCampaignTask: async (payload) =>
      runExecuteCampaignWithRuntime(payload as ICampaignConfig, {
        ensureNode: options.ensureNode,
        executeTask:
          process.env.LOBSTER_RUNTIME_ENABLE_CONTENT_EXECUTE_TASK === 'true'
            ? createRuntimeContentExecuteTask()
            : undefined,
      }),
  };
}
