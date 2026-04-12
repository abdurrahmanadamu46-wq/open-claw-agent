import { WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { Queue } from 'bullmq';
import type { MatrixDispatchJobPayload, LeadHarvestJobPayload } from '../autopilot.types';
import { AutopilotCircuitService } from '../autopilot-circuit.service';
export declare class MatrixDispatchWorker extends WorkerHost {
    private readonly leadHarvestQueue;
    private readonly circuit;
    private readonly logger;
    constructor(leadHarvestQueue: Queue, circuit: AutopilotCircuitService);
    process(job: Job<MatrixDispatchJobPayload>): Promise<LeadHarvestJobPayload | void>;
    private dispatchToNodes;
}
