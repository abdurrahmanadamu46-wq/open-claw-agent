"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var DeviceService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeviceService = void 0;
const common_1 = require("@nestjs/common");
let DeviceService = DeviceService_1 = class DeviceService {
    constructor() {
        this.logger = new common_1.Logger(DeviceService_1.name);
        this.store = new Map();
    }
    async upsertDevice(input) {
        const key = `${input.tenant_id}:${input.machine_code}`;
        this.store.set(key, input);
        this.logger.log(`[Device] upsert ${key} status=${input.status}`);
    }
};
exports.DeviceService = DeviceService;
exports.DeviceService = DeviceService = DeviceService_1 = __decorate([
    (0, common_1.Injectable)()
], DeviceService);
//# sourceMappingURL=device.service.js.map