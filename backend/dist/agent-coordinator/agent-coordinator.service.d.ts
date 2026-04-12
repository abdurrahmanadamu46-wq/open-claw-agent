import type { FinalActionPayload } from './agent-workflow.types';
import { IntegrationsService } from '../integrations/integrations.service';
import type { LLMToolsInput } from './agent-coordinator.types';
export declare class AgentCoordinatorService {
    private readonly integrationsService;
    private workflowGraph;
    constructor(integrationsService: IntegrationsService);
    runAgentWorkflow(tenantId: string, rawTaskInput: string): Promise<{
        finalActionPayload: FinalActionPayload | null;
        errorLog: string[];
    }>;
    injectUserToolsIntoContext(tenantId: string): Promise<LLMToolsInput>;
}
