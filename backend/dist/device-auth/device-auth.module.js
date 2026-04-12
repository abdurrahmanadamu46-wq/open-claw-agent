"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeviceAuthModule = void 0;
const common_1 = require("@nestjs/common");
const device_auth_controller_1 = require("./device-auth.controller");
const device_auth_service_1 = require("./device-auth.service");
const device_service_1 = require("../device/device.service");
const agent_cc_gateway_1 = require("../gateway/agent-cc.gateway");
const jwt_auth_guard_1 = require("../auth/jwt-auth.guard");
let DeviceAuthModule = class DeviceAuthModule {
};
exports.DeviceAuthModule = DeviceAuthModule;
exports.DeviceAuthModule = DeviceAuthModule = __decorate([
    (0, common_1.Module)({
        controllers: [device_auth_controller_1.DeviceAuthController],
        providers: [
            device_auth_service_1.DeviceAuthService,
            device_service_1.DeviceService,
            agent_cc_gateway_1.AgentCCGateway,
            jwt_auth_guard_1.JwtAuthGuard,
        ],
        exports: [device_auth_service_1.DeviceAuthService],
    })
], DeviceAuthModule);
//# sourceMappingURL=device-auth.module.js.map