import { AUTOPILOT_QUEUES } from './autopilot.constants';
import { AutopilotAlertGateway } from './autopilot-alert.gateway';
type QueueName = (typeof AUTOPILOT_QUEUES)[number];
export declare class AutopilotCircuitService {
    private readonly alertGateway;
    private readonly consecutiveFailures;
    private circuitOpen;
    constructor(alertGateway: AutopilotAlertGateway);
    isCircuitOpen(): boolean;
    recordSuccess(queueName: QueueName): void;
    recordFailure(queueName: QueueName): boolean;
    resetCircuit(): void;
}
export {};
