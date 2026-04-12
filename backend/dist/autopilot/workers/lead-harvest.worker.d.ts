import { WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import type { LeadHarvestJobPayload } from '../autopilot.types';
import { AutopilotCircuitService } from '../autopilot-circuit.service';
export declare class LeadHarvestWorker extends WorkerHost {
    private readonly circuit;
    private readonly logger;
    constructor(circuit: AutopilotCircuitService);
    process(job: Job<LeadHarvestJobPayload>): Promise<void>;
    private harvestLeads;
}
