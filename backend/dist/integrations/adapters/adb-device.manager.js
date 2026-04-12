"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdbDeviceManagerStub = void 0;
class AdbDeviceManagerStub {
    constructor() {
        this.name = 'adb-device-manager-stub';
    }
    async connectDevice(adbAddress) {
        return { address: adbAddress, connected: true, label: 'stub' };
    }
    async swipe(_x1, _y1, _x2, _y2, _deviceAddress) {
    }
}
exports.AdbDeviceManagerStub = AdbDeviceManagerStub;
//# sourceMappingURL=adb-device.manager.js.map