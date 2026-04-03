import { Module } from '@nestjs/common';
import { AotoCutController } from './aoto-cut.controller';
import { AotoCutService } from './aoto-cut.service';

@Module({
  controllers: [AotoCutController],
  providers: [AotoCutService],
  exports: [AotoCutService],
})
export class AotoCutModule {}
