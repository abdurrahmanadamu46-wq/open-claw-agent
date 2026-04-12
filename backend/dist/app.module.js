"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const jwt_1 = require("@nestjs/jwt");
const bullmq_1 = require("@nestjs/bullmq");
const schedule_1 = require("@nestjs/schedule");
const nestjs_redis_1 = require("@liaoliaots/nestjs-redis");
const device_auth_module_1 = require("./device-auth/device-auth.module");
const gateway_module_1 = require("./gateway/gateway.module");
const integrations_module_1 = require("./integrations/integrations.module");
const agent_coordinator_module_1 = require("./agent-coordinator/agent-coordinator.module");
const autopilot_module_1 = require("./autopilot/autopilot.module");
const vlm_module_1 = require("./vlm/vlm.module");
const mcp_module_1 = require("./mcp/mcp.module");
const llm_module_1 = require("./llm/llm.module");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            schedule_1.ScheduleModule.forRoot(),
            nestjs_redis_1.RedisModule.forRoot({
                config: {
                    host: process.env.REDIS_HOST ?? '127.0.0.1',
                    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
                },
            }),
            bullmq_1.BullModule.forRoot({
                connection: {
                    host: process.env.REDIS_HOST ?? '127.0.0.1',
                    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
                },
            }),
            jwt_1.JwtModule.register({
                global: true,
                secret: process.env.JWT_SECRET ?? 'dev-secret-change-in-production',
                signOptions: { expiresIn: '30d' },
            }),
            device_auth_module_1.DeviceAuthModule,
            gateway_module_1.GatewayModule,
            integrations_module_1.IntegrationsModule,
            agent_coordinator_module_1.AgentCoordinatorModule,
            autopilot_module_1.AutopilotModule,
            vlm_module_1.VlmModule,
            mcp_module_1.McpModule,
            llm_module_1.LlmModule,
        ],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map