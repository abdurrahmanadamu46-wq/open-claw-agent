export interface UpsertDeviceInput {
    tenant_id: string;
    machine_code: string;
    status: string;
}
export declare class DeviceService {
    private readonly logger;
    private readonly store;
    upsertDevice(input: UpsertDeviceInput): Promise<void>;
}
