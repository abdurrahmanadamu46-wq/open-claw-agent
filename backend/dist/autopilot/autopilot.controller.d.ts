import { AutopilotCoordinatorService } from './autopilot-coordinator.service';
import { AutopilotCircuitService } from './autopilot-circuit.service';
import type { RadarSniffingJobPayload } from './autopilot.types';
export declare class AutopilotController {
    private readonly coordinator;
    private readonly circuit;
    constructor(coordinator: AutopilotCoordinatorService, circuit: AutopilotCircuitService);
    status(): {
        circuitOpen: boolean;
    };
    triggerProbe(body?: Partial<RadarSniffingJobPayload>): Promise<{
        jobId: string;
    }>;
    resetCircuit(): {
        ok: boolean;
    };
}
