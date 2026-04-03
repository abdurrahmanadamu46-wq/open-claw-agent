import {
  listIndustryOptions,
  compileIndustryWorkflowBlueprint,
  buildIndustryWorkflowRuntimeHandoffBundle,
  buildIndustryWorkflowFrontendPreview,
  type IndustryWorkflowRequest,
} from './commander/index.js';

export interface IndustryPreviewIncomingMessage {
  method?: string;
  url?: string;
  [Symbol.asyncIterator]?(): AsyncIterableIterator<Buffer | string>;
}

export interface IndustryPreviewServerResponse {
  setHeader(name: string, value: string | number): void;
  writeHead(status: number, headers?: Record<string, string>): void;
  end(body?: string): void;
  statusCode?: number;
}

async function readJsonBody<T>(req: IndustryPreviewIncomingMessage): Promise<T> {
  const iterator = req[Symbol.asyncIterator];
  if (!iterator) {
    throw new Error('Request body is not readable');
  }

  let body = '';
  for await (const chunk of req) {
    body += chunk.toString();
  }

  return JSON.parse(body || '{}') as T;
}

function validateIndustryWorkflowRequest(input: unknown): asserts input is IndustryWorkflowRequest {
  if (!input || typeof input !== 'object') {
    throw new Error('Request body must be an object');
  }

  const payload = input as Record<string, unknown>;
  const merchantProfile = payload.merchantProfile;

  if (typeof payload.workflowId !== 'string' || payload.workflowId.trim().length < 3) {
    throw new Error('workflowId is required');
  }
  if (typeof payload.categoryId !== 'string' || !payload.categoryId.trim()) {
    throw new Error('categoryId is required');
  }
  if (typeof payload.subIndustryId !== 'string' || !payload.subIndustryId.trim()) {
    throw new Error('subIndustryId is required');
  }
  if (!merchantProfile || typeof merchantProfile !== 'object') {
    throw new Error('merchantProfile is required');
  }

  const profile = merchantProfile as Record<string, unknown>;
  for (const field of ['customerPainPoints', 'solvedProblems', 'competitiveAdvantages']) {
    if (!Array.isArray(profile[field]) || profile[field]!.length === 0) {
      throw new Error(`${field} must be a non-empty array`);
    }
  }
  if (typeof profile.personaBackground !== 'string' || profile.personaBackground.trim().length < 4) {
    throw new Error('personaBackground is required');
  }
}

export function getIndustryCatalogHandler() {
  return async (_req: IndustryPreviewIncomingMessage, res: IndustryPreviewServerResponse): Promise<void> => {
    try {
      const data = {
        version: 'lobster.industry-catalog-response.v0.1',
        generatedAt: new Date().toISOString(),
        categories: listIndustryOptions(),
      };
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(200);
      res.end(JSON.stringify(data));
    } catch (err) {
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Failed to get industry catalog', message: (err as Error).message }));
    }
  };
}

export function compileIndustryWorkflowHandler() {
  return async (req: IndustryPreviewIncomingMessage, res: IndustryPreviewServerResponse): Promise<void> => {
    try {
      const payload = await readJsonBody<IndustryWorkflowRequest>(req);
      validateIndustryWorkflowRequest(payload);

      const blueprint = compileIndustryWorkflowBlueprint(payload);
      const runtimeHandoff = buildIndustryWorkflowRuntimeHandoffBundle(payload);
      const frontendPreview = buildIndustryWorkflowFrontendPreview(blueprint, runtimeHandoff);
      const stepAgentPreview = blueprint.businessSteps.map((step) => ({
        stepNumber: step.stepNumber,
        stepId: step.stepId,
        ownerRole: step.ownerRole,
        ownerBaselineAgentId: step.ownerBaselineAgent?.baselineAgentId ?? null,
        ownerStarterSkills: step.ownerBaselineAgent?.starterSkills ?? [],
        supportRoles: step.supportRoles,
        supportBaselineAgentIds: step.supportBaselineAgents.map((binding) => binding.baselineAgentId),
        bridgeTarget: step.runtimeAction.bridgeTarget,
        scopeId: step.runtimeAction.scopeId ?? null,
      }));

      res.setHeader('Content-Type', 'application/json');
      res.writeHead(200);
      res.end(
        JSON.stringify({
          version: 'lobster.industry-workflow-preview-response.v0.3',
          generatedAt: new Date().toISOString(),
          blueprint,
          runtimeHandoff,
          stepAgentPreview,
          frontendPreview,
        }),
      );
    } catch (err) {
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Failed to compile industry workflow', message: (err as Error).message }));
    }
  };
}
