/**
 * Behavior OS public API:
 * persona / intent / behavior path / session / scoring / pool
 */
import { BadRequestException, Body, Controller, Get, Logger, Post, Query, Req, UseGuards } from '@nestjs/common';
import { PersonaEngineService } from './persona-engine.service';
import { IntentEngineService } from './intent-engine.service';
import { BehaviorEngineService } from './behavior-engine.service';
import { BehaviorRuntimeService } from './behavior-runtime.service';
import { BehaviorLoggerService } from './behavior-logger.service';
import { BehaviorPoolService } from './behavior-pool.service';
import { ScoringEngineService } from './scoring-engine.service';
import type { Persona, BehaviorPath, IntentOutput } from './types';
import type { BehaviorSessionPayload } from './behavior-dispatch.types';
import type { BehaviorLogEntry } from './behavior-scoring.types';
import { BehaviorEventBus } from './behavior-event.bus';
import { emitStructuredLog } from '../common/structured-log';
import { BehaviorTraceService } from './behavior-trace.service';
import { BehaviorBiasPolicyService } from './behavior-bias-policy.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminRoleGuard } from '../auth/admin-role.guard';

type AuthedRequest = {
  user?: {
    tenantId?: string;
    roles?: string[];
    isAdmin?: boolean;
  };
};

@Controller('behavior')
export class BehaviorController {
  private readonly logger = new Logger(BehaviorController.name);

  constructor(
    private readonly persona: PersonaEngineService,
    private readonly intent: IntentEngineService,
    private readonly behavior: BehaviorEngineService,
    private readonly runtime: BehaviorRuntimeService,
    private readonly behaviorLogger: BehaviorLoggerService,
    private readonly pool: BehaviorPoolService,
    private readonly scoring: ScoringEngineService,
    private readonly eventBus: BehaviorEventBus,
    private readonly traceService: BehaviorTraceService,
    private readonly biasPolicy: BehaviorBiasPolicyService,
  ) {}

  @Get('persona')
  getPersona(@Query('seed') seed: string) {
    const s = seed ?? `seed_${Date.now()}`;
    return this.persona.generate(s);
  }

  @Post('intent')
  resolveIntent(@Body() body: { persona: Persona; contentTags: string[]; goal?: string }) {
    return this.intent.resolve({
      persona: body.persona,
      contentTags: body.contentTags ?? [],
      goal: body.goal,
    });
  }

  @Post('path')
  async generatePath(
    @Body()
    body: {
      persona: Persona;
      intent?: IntentOutput;
      targetId?: string;
      commentContent?: string;
      sessionId?: string;
      node_id?: string;
      current_task?: string;
      persona_id?: string;
      tenant_id?: string;
      campaign_id?: string;
      trace_id?: string;
      task_id?: string;
      template_id?: string;
    },
  ) {
    const generated = await this.behavior.generatePathWithContext({
      persona: body.persona,
      intent: body.intent,
      targetId: body.targetId,
      commentContent: body.commentContent,
      sessionId: body.sessionId,
      node_id: body.node_id,
      current_task: body.current_task,
      persona_id: body.persona_id,
      tenant_id: body.tenant_id,
      template_id: body.template_id,
    });

    const normalized = this.behavior.normalizeDelays(generated.path);
    this.eventBus.emitBehaviorPathGenerated({
      session_id: normalized.session_id,
      tenant_id: body.tenant_id,
      campaign_id: body.campaign_id,
      trace_id: body.trace_id,
      steps_count: normalized.steps.length,
    });

    emitStructuredLog(this.logger, 'log', {
      service: 'behavior-controller',
      eventType: 'behavior.path.generated',
      message: 'Behavior path generated',
      traceId: body.trace_id,
      tenantId: body.tenant_id,
      campaignId: body.campaign_id,
      nodeId: body.node_id,
      taskId: body.task_id ?? normalized.session_id,
      memory_hits: generated.memoryHits,
      blended_bias: generated.blendedBias,
      bias_policy: generated.biasPolicy,
    });

    if (body.trace_id?.trim()) {
      try {
        await this.traceService.appendSnapshot(body.trace_id, {
          sessionId: normalized.session_id,
          tenantId: body.tenant_id,
          campaignId: body.campaign_id,
          nodeId: body.node_id,
          taskId: body.task_id ?? normalized.session_id,
          templateId: body.template_id,
          eventType: 'behavior.path.generated',
          memoryHits: generated.memoryHits,
          blendedBias: generated.blendedBias,
          issueCode:
            generated.memoryHits === 0 && body.node_id?.trim() && body.current_task?.trim()
              ? 'memory.empty'
              : undefined,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `[BehaviorTraceDegraded] traceId=${body.trace_id} sessionId=${normalized.session_id}: ${message}`,
        );
      }
    }

    return {
      ...normalized,
      memory_hits: generated.memoryHits,
      blended_bias: generated.blendedBias,
      bias_policy: generated.biasPolicy,
    };
  }

  @Post('session')
  async createSession(
    @Body()
    body: {
      seed: string;
      contentTags?: string[];
      targetId?: string;
      tenant_id: string;
      campaign_id?: string;
      trace_id?: string;
      node_id?: string;
      current_task?: string;
      template_id?: string;
      task_id?: string;
    },
  ) {
    const seed = body.seed ?? `s_${Date.now()}`;
    const persona = this.persona.generate(seed);
    const intent = this.intent.resolve({
      persona,
      contentTags: body.contentTags ?? [],
    });

    const generated = await this.behavior.generatePathWithContext({
      persona,
      intent,
      targetId: body.targetId,
      sessionId: `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      node_id: body.node_id,
      current_task: body.current_task,
      persona_id: persona.persona_id,
      tenant_id: body.tenant_id,
      template_id: body.template_id,
    });

    const normalized = this.behavior.normalizeDelays(generated.path);

    const payload: BehaviorSessionPayload = {
      session_id: normalized.session_id,
      tenant_id: body.tenant_id,
      trace_id: body.trace_id,
      campaign_id: body.campaign_id,
      persona,
      intent,
      behavior_path: normalized,
      created_at: new Date().toISOString(),
    };

    this.eventBus.emitBehaviorPathGenerated({
      session_id: payload.session_id,
      tenant_id: payload.tenant_id,
      campaign_id: payload.campaign_id,
      trace_id: payload.trace_id,
      steps_count: normalized.steps.length,
    });

    emitStructuredLog(this.logger, 'log', {
      service: 'behavior-controller',
      eventType: 'behavior.session.created',
      message: 'Behavior session created',
      traceId: body.trace_id,
      tenantId: body.tenant_id,
      campaignId: body.campaign_id,
      nodeId: body.node_id,
      taskId: body.task_id ?? payload.session_id,
      memory_hits: generated.memoryHits,
      blended_bias: generated.blendedBias,
      bias_policy: generated.biasPolicy,
    });

    if (body.trace_id?.trim()) {
      try {
        await this.traceService.appendSnapshot(body.trace_id, {
          sessionId: payload.session_id,
          tenantId: body.tenant_id,
          campaignId: body.campaign_id,
          nodeId: body.node_id,
          taskId: body.task_id ?? payload.session_id,
          templateId: body.template_id,
          eventType: 'behavior.session.created',
          memoryHits: generated.memoryHits,
          blendedBias: generated.blendedBias,
          issueCode:
            generated.memoryHits === 0 && body.node_id?.trim() && body.current_task?.trim()
              ? 'memory.empty'
              : undefined,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `[BehaviorTraceDegraded] traceId=${body.trace_id} sessionId=${payload.session_id}: ${message}`,
        );
      }
    }

    return {
      ...payload,
      memory_hits: generated.memoryHits,
      blended_bias: generated.blendedBias,
      bias_policy: generated.biasPolicy,
    };
  }

  @Get('bias-policy')
  async getBiasPolicy(
    @Query('tenant_id') tenantId?: string,
    @Query('template_id') templateId?: string,
  ) {
    const policy = await this.biasPolicy.resolvePolicy({
      tenant_id: tenantId?.trim() || undefined,
      template_id: templateId?.trim() || undefined,
    });
    return { ok: true, policy };
  }

  @Post('bias-policy')
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  async upsertBiasPolicy(
    @Body()
    body: {
      tenant_id: string;
      template_id?: string;
      weights: {
        intentWeight?: number;
        memoryWeight?: number;
        personaWeight?: number;
        aggressivenessBoost?: number;
      };
    },
    @Req() req?: AuthedRequest,
  ) {
    const tenantScope = req?.user?.tenantId?.trim();
    if (!tenantScope) {
      throw new BadRequestException('tenant scope is required');
    }
    const tenantId = body?.tenant_id?.trim();
    if (!tenantId) {
      throw new BadRequestException('tenant_id is required');
    }
    if (tenantId !== tenantScope) {
      throw new BadRequestException('tenant_id must match tenant scope');
    }
    if (!body?.weights || typeof body.weights !== 'object') {
      throw new BadRequestException('weights is required');
    }
    const policy = await this.biasPolicy.upsertPolicy({
      tenant_id: tenantScope,
      template_id: body.template_id?.trim() || undefined,
      weights: body.weights,
    });
    return { ok: true, policy };
  }

  @Post('interpret')
  interpretPath(@Body() body: { behavior_path: BehaviorPath }) {
    return this.runtime.interpret(body.behavior_path);
  }

  @Post('log')
  logBehavior(@Body() body: BehaviorLogEntry) {
    const entry: BehaviorLogEntry = {
      ...body,
      created_at: body.created_at ?? new Date().toISOString(),
    };
    return this.behaviorLogger.log(entry);
  }

  @Get('pool')
  getPoolTemplates(@Query('limit') limit?: string, @Query('minScore') minScore?: string) {
    const l = limit ? parseInt(limit, 10) : 10;
    const m = minScore ? parseFloat(minScore) : 0.6;
    return { templates: this.pool.getTemplates(l, m), poolSize: this.pool.getPoolSize() };
  }

  @Get('pool/top')
  getPoolTop(@Query('limit') limit?: string) {
    const l = limit ? parseInt(limit, 10) : 20;
    return this.pool.getTopScored(l);
  }

  @Get('scoring/weights')
  getScoreWeights() {
    return this.scoring.getDefaultWeights();
  }
}
