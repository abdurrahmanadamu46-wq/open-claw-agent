import { WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { Queue } from 'bullmq';
import type { RadarSniffingJobPayload } from '../autopilot.types';
import type { ContentForgeJobPayload } from '../autopilot.types';
import { AutopilotCircuitService } from '../autopilot-circuit.service';
export declare class RadarSniffingWorker extends WorkerHost {
    private readonly contentForgeQueue;
    private readonly circuit;
    private readonly logger;
    constructor(contentForgeQueue: Queue, circuit: AutopilotCircuitService);
    process(job: Job<RadarSniffingJobPayload>): Promise<ContentForgeJobPayload | void>;
    private sniffViralContent;
}
