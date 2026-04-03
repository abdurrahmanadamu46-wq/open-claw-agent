import { Module } from '@nestjs/common';
import { LobsterMemoryClientService } from './lobster-memory-client.service';
import { MemoryController } from './memory.controller';

@Module({
  controllers: [MemoryController],
  providers: [LobsterMemoryClientService],
  exports: [LobsterMemoryClientService],
})
export class MemoryModule {}
