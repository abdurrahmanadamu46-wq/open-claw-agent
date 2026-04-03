import { Module } from '@nestjs/common';
import { ClientUpdateController } from './client-update.controller';
import { ClientUpdateService } from './client-update.service';

@Module({
  controllers: [ClientUpdateController],
  providers: [ClientUpdateService],
  exports: [ClientUpdateService],
})
export class ClientUpdateModule {}
