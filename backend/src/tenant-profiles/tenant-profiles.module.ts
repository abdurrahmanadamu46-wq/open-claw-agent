import { Module } from '@nestjs/common';
import { TenantProfilesController } from './tenant-profiles.controller';
import { RagBrainProfilesService } from './rag-brain-profiles.service';
import { EdgePersonaMasksService } from './edge-persona-masks.service';
import { RagCompetitiveIntelService } from './rag-competitive-intel.service';
import { TenantRegistryService } from './tenant-registry.service';

@Module({
  controllers: [TenantProfilesController],
  providers: [RagBrainProfilesService, EdgePersonaMasksService, RagCompetitiveIntelService, TenantRegistryService],
  exports: [RagBrainProfilesService, EdgePersonaMasksService, RagCompetitiveIntelService, TenantRegistryService],
})
export class TenantProfilesModule {}
