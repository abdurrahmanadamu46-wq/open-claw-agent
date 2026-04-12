"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.IntegrationsModule = void 0;
const common_1 = require("@nestjs/common");
const bullmq_1 = require("@nestjs/bullmq");
const integrations_controller_1 = require("./integrations.controller");
const integrations_service_1 = require("./integrations.service");
const webhook_dispatcher_service_1 = require("./webhook-dispatcher.service");
const webhook_worker_1 = require("./webhook.worker");
const webhook_queue_const_1 = require("./webhook-queue.const");
const storage_adapter_1 = require("./adapters/storage.adapter");
const adb_device_manager_1 = require("./adapters/adb-device.manager");
const comment_reply_service_1 = require("./adapters/comment-reply.service");
let IntegrationsModule = class IntegrationsModule {
};
exports.IntegrationsModule = IntegrationsModule;
exports.IntegrationsModule = IntegrationsModule = __decorate([
    (0, common_1.Module)({
        imports: [
            bullmq_1.BullModule.registerQueue({
                name: webhook_queue_const_1.WEBHOOK_DISPATCH_QUEUE,
            }),
        ],
        controllers: [integrations_controller_1.IntegrationsController],
        providers: [
            integrations_service_1.IntegrationsService,
            webhook_dispatcher_service_1.WebhookDispatcherService,
            webhook_worker_1.WebhookWorker,
            storage_adapter_1.StorageAdapterStub,
            adb_device_manager_1.AdbDeviceManagerStub,
            comment_reply_service_1.CommentReplyServiceStub,
        ],
        exports: [integrations_service_1.IntegrationsService, webhook_dispatcher_service_1.WebhookDispatcherService, storage_adapter_1.StorageAdapterStub, adb_device_manager_1.AdbDeviceManagerStub, comment_reply_service_1.CommentReplyServiceStub],
    })
], IntegrationsModule);
//# sourceMappingURL=integrations.module.js.map