import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { WebhookDispatcherService } from './webhook-dispatcher.service';
import { WebhookWorker } from './webhook.worker';
import { WEBHOOK_DISPATCH_QUEUE } from './webhook-queue.const';
import { StorageAdapterStub } from './adapters/storage.adapter';
import { AdbDeviceManagerStub } from './adapters/adb-device.manager';
import { CommentReplyServiceStub } from './adapters/comment-reply.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: WEBHOOK_DISPATCH_QUEUE,
    }),
  ],
  controllers: [IntegrationsController],
  providers: [
    IntegrationsService,
    WebhookDispatcherService,
    WebhookWorker,
    StorageAdapterStub,
    AdbDeviceManagerStub,
    CommentReplyServiceStub,
  ],
  exports: [IntegrationsService, WebhookDispatcherService, StorageAdapterStub, AdbDeviceManagerStub, CommentReplyServiceStub],
})
export class IntegrationsModule {}
