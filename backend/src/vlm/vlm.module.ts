import { Module } from '@nestjs/common';
import { VlmController } from './vlm.controller';

@Module({
  controllers: [VlmController],
})
export class VlmModule {}
