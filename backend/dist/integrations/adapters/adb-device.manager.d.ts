export interface AdbDeviceConnection {
    address: string;
    connected: boolean;
    label?: string;
}
export interface AdbDeviceManager {
    readonly name: string;
    connectDevice(adbAddress: string): Promise<AdbDeviceConnection>;
    swipe(x1: number, y1: number, x2: number, y2: number, deviceAddress?: string): Promise<void>;
    disconnectDevice?(adbAddress: string): Promise<void>;
}
export declare class AdbDeviceManagerStub implements AdbDeviceManager {
    readonly name = "adb-device-manager-stub";
    connectDevice(adbAddress: string): Promise<AdbDeviceConnection>;
    swipe(_x1: number, _y1: number, _x2: number, _y2: number, _deviceAddress?: string): Promise<void>;
}
