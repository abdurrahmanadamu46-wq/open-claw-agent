import { Queue } from 'bullmq';
import type { RadarSniffingJobPayload } from './autopilot.types';
import { AutopilotCircuitService } from './autopilot-circuit.service';
export declare class AutopilotCoordinatorService {
    private readonly radarQueue;
    private readonly circuit;
    private readonly logger;
    constructor(radarQueue: Queue, circuit: AutopilotCircuitService);
    heartbeat(): Promise<void>;
    triggerProbe(overrides?: Partial<RadarSniffingJobPayload>): Promise<string>;
    resetCircuit(): void;
}
