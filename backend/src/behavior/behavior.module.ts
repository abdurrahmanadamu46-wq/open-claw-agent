import { Module } from '@nestjs/common';
import { MemoryModule } from '../memory/memory.module';
import { PersonaEngineService } from './persona-engine.service';
import { IntentEngineService } from './intent-engine.service';
import { BehaviorEngineService } from './behavior-engine.service';
import { BehaviorRuntimeService } from './behavior-runtime.service';
import { BehaviorEventBus } from './behavior-event.bus';
import { BehaviorEventBusListener } from './behavior-event.listener';
import { ScoringEngineService } from './scoring-engine.service';
import { BehaviorPoolService } from './behavior-pool.service';
import { BehaviorLoggerService } from './behavior-logger.service';
import { BehaviorController } from './behavior.controller';
import { BehaviorTraceService } from './behavior-trace.service';
import { BehaviorBiasPolicyService } from './behavior-bias-policy.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminRoleGuard } from '../auth/admin-role.guard';

@Module({
  imports: [MemoryModule],
  controllers: [BehaviorController],
  providers: [
    PersonaEngineService,
    IntentEngineService,
    BehaviorEngineService,
    BehaviorRuntimeService,
    BehaviorEventBus,
    BehaviorEventBusListener,
    ScoringEngineService,
    BehaviorPoolService,
    BehaviorLoggerService,
    BehaviorTraceService,
    BehaviorBiasPolicyService,
    JwtAuthGuard,
    AdminRoleGuard,
  ],
  exports: [
    PersonaEngineService,
    IntentEngineService,
    BehaviorEngineService,
    BehaviorRuntimeService,
    BehaviorEventBus,
    ScoringEngineService,
    BehaviorPoolService,
    BehaviorLoggerService,
    BehaviorTraceService,
    BehaviorBiasPolicyService,
  ],
})
export class BehaviorModule {}
