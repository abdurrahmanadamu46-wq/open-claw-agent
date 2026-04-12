import { WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { Queue } from 'bullmq';
import { RedisService } from '@liaoliaots/nestjs-redis';
import type { ContentForgeJobPayload, MatrixDispatchJobPayload } from '../autopilot.types';
import { AutopilotCircuitService } from '../autopilot-circuit.service';
import { IntegrationsService } from '../../integrations/integrations.service';
import { LlmService } from '../../llm/llm.service';
export declare class ContentForgeWorker extends WorkerHost {
    private readonly matrixDispatchQueue;
    private readonly circuit;
    private readonly redisService;
    private readonly integrationsService;
    private readonly llmService;
    private readonly logger;
    constructor(matrixDispatchQueue: Queue, circuit: AutopilotCircuitService, redisService: RedisService, integrationsService: IntegrationsService, llmService: LlmService);
    private get redis();
    process(job: Job<ContentForgeJobPayload>): Promise<MatrixDispatchJobPayload | void>;
    private forgeContent;
    private getTenantNodeIds;
}
