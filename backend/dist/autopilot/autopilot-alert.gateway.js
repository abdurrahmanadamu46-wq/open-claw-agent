"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var AutopilotAlertGateway_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AutopilotAlertGateway = void 0;
const common_1 = require("@nestjs/common");
const websockets_1 = require("@nestjs/websockets");
const socket_io_1 = require("socket.io");
let AutopilotAlertGateway = AutopilotAlertGateway_1 = class AutopilotAlertGateway {
    constructor() {
        this.logger = new common_1.Logger(AutopilotAlertGateway_1.name);
    }
    afterInit() {
        this.logger.log('AutopilotAlertGateway initialized at /autopilot-alert');
    }
    emitAutopilotAlert(message, payload) {
        try {
            this.server.emit('autopilot.alert', { message, ...payload });
            this.logger.warn(`[Autopilot] Alert emitted: ${message}`);
        }
        catch (e) {
            this.logger.error('[Autopilot] Failed to emit alert', e);
        }
    }
};
exports.AutopilotAlertGateway = AutopilotAlertGateway;
__decorate([
    (0, websockets_1.WebSocketServer)(),
    __metadata("design:type", socket_io_1.Server)
], AutopilotAlertGateway.prototype, "server", void 0);
exports.AutopilotAlertGateway = AutopilotAlertGateway = AutopilotAlertGateway_1 = __decorate([
    (0, websockets_1.WebSocketGateway)({
        path: '/autopilot-alert',
        cors: { origin: true },
    })
], AutopilotAlertGateway);
//# sourceMappingURL=autopilot-alert.gateway.js.map