/**
 * Behavior Engine
 * - Generates behavior paths from persona + intent
 * - Optionally retrieves memory context (node/task scoped)
 * - Blends intent bias with memory bias before sampling actions
 */
import { Injectable } from '@nestjs/common';
import type { Persona } from './types/persona.types';
import type { IntentOutput, ActionBias } from './types/intent.types';
import type { BehaviorPath, BehaviorStep, BehaviorAction } from './types/behavior.types';
import { BehaviorPoolService } from './behavior-pool.service';
import { LobsterMemoryClientService } from '../memory/lobster-memory-client.service';
import type { MemoryItem } from '../memory/memory.types';
import { BehaviorBiasPolicyService } from './behavior-bias-policy.service';
import type { BehaviorBiasPolicyRecord, BehaviorBiasWeights } from './types';

export interface BehaviorEngineInput {
  persona: Persona;
  intent?: IntentOutput;
  targetId?: string;
  commentContent?: string;
  sessionId?: string;
  usePool?: boolean;
  node_id?: string;
  current_task?: string;
  persona_id?: string;
  tenant_id?: string;
  template_id?: string;
}

export interface BehaviorPathContext {
  path: BehaviorPath;
  memoryHits: number;
  blendedBias: Required<ActionBias>;
  biasPolicy: BehaviorBiasPolicyRecord;
}

interface MemoryBias {
  like: number;
  comment: number;
  follow: number;
  share: number;
  preferredComment?: string;
}

function randomizeDelay(base: number, rnd: () => number): number {
  return Math.round(base * (0.8 + rnd() * 0.4) * 100) / 100;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

@Injectable()
export class BehaviorEngineService {
  constructor(
    private readonly pool: BehaviorPoolService,
    private readonly memory: LobsterMemoryClientService,
    private readonly biasPolicy: BehaviorBiasPolicyService,
  ) {}

  private async retrieveRelevantMemories(input: BehaviorEngineInput): Promise<MemoryItem[]> {
    if (!input.node_id || !input.current_task) return [];
    const memories = await this.memory.retrieveAdaptiveMemory({
      node_id: input.node_id,
      current_task: input.current_task,
      top_k: 5,
      persona_id: input.persona_id ?? input.persona.persona_id,
    });
    return memories;
  }

  private deriveMemoryBias(memories: MemoryItem[]): MemoryBias {
    if (memories.length === 0) {
      return { like: 0.6, comment: 0.2, follow: 0.1, share: 0.1 };
    }

    let weightedLike = 0;
    let weightedComment = 0;
    let weightedFollow = 0;
    let weightedShare = 0;
    let totalWeight = 0;
    let preferredComment: string | undefined;

    for (const item of memories) {
      const weight = Math.max(0.05, item.final_score || 0);
      const ctx = item.memory_details?.context_data ?? {};
      const bias =
        typeof ctx.action_bias === 'object' && ctx.action_bias != null
          ? (ctx.action_bias as ActionBias)
          : undefined;

      const like =
        typeof bias?.like === 'number'
          ? bias.like
          : typeof ctx.like_prob === 'number'
            ? Number(ctx.like_prob)
            : typeof ctx.liked === 'boolean'
              ? (ctx.liked ? 1 : 0)
              : 0.6;
      const comment =
        typeof bias?.comment === 'number'
          ? bias.comment
          : typeof ctx.comment_prob === 'number'
            ? Number(ctx.comment_prob)
            : typeof ctx.commented === 'boolean'
              ? (ctx.commented ? 1 : 0)
              : 0.2;
      const follow =
        typeof bias?.follow === 'number'
          ? bias.follow
          : typeof ctx.follow_prob === 'number'
            ? Number(ctx.follow_prob)
            : 0.1;
      const share =
        typeof bias?.share === 'number'
          ? bias.share
          : typeof ctx.share_prob === 'number'
            ? Number(ctx.share_prob)
            : 0.1;

      weightedLike += clamp01(Number(like)) * weight;
      weightedComment += clamp01(Number(comment)) * weight;
      weightedFollow += clamp01(Number(follow)) * weight;
      weightedShare += clamp01(Number(share)) * weight;
      totalWeight += weight;

      if (!preferredComment && typeof ctx.preferred_comment === 'string' && ctx.preferred_comment.trim()) {
        preferredComment = ctx.preferred_comment.trim();
      }
      if (!preferredComment && typeof ctx.comment_template === 'string' && ctx.comment_template.trim()) {
        preferredComment = ctx.comment_template.trim();
      }
    }

    if (totalWeight <= 0) {
      return { like: 0.6, comment: 0.2, follow: 0.1, share: 0.1, preferredComment };
    }

    return {
      like: clamp01(weightedLike / totalWeight),
      comment: clamp01(weightedComment / totalWeight),
      follow: clamp01(weightedFollow / totalWeight),
      share: clamp01(weightedShare / totalWeight),
      preferredComment,
    };
  }

  private blendBias(
    intentBias: ActionBias | undefined,
    memoryBias: MemoryBias,
    persona: Persona,
    weights: BehaviorBiasWeights,
  ): Required<ActionBias> {
    const personaLike = clamp01(persona.interaction_preference?.like ?? 0.6);
    const personaComment = clamp01(persona.interaction_preference?.comment ?? 0.2);
    const personaFollow = clamp01((persona.interaction_preference?.share ?? 0.1) * 0.5 + 0.05);
    const personaShare = clamp01(persona.interaction_preference?.share ?? 0.1);

    const intentLike = clamp01(intentBias?.like ?? 0.6);
    const intentComment = clamp01(intentBias?.comment ?? 0.2);
    const intentFollow = clamp01(intentBias?.follow ?? 0.1);
    const intentShare = clamp01(intentBias?.share ?? 0.1);

    const intentWeight = clamp01(weights.intentWeight);
    const memoryWeight = clamp01(weights.memoryWeight);
    const personaWeight = clamp01(weights.personaWeight);
    const sum = intentWeight + memoryWeight + personaWeight || 1;
    const normalizedIntentWeight = intentWeight / sum;
    const normalizedMemoryWeight = memoryWeight / sum;
    const normalizedPersonaWeight = personaWeight / sum;
    const aggressiveness = clamp01(persona.aggressiveness ?? 0.5);
    const aggressivenessBoost = clamp01(weights.aggressivenessBoost);

    const like = clamp01(
      intentLike * normalizedIntentWeight +
        memoryBias.like * normalizedMemoryWeight +
        personaLike * normalizedPersonaWeight,
    );
    const comment = clamp01(
      intentComment * normalizedIntentWeight +
        memoryBias.comment * normalizedMemoryWeight +
        personaComment * normalizedPersonaWeight,
    );
    const follow = clamp01(
      intentFollow * normalizedIntentWeight +
        memoryBias.follow * normalizedMemoryWeight +
        personaFollow * normalizedPersonaWeight +
        aggressiveness * aggressivenessBoost,
    );
    const share = clamp01(
      intentShare * normalizedIntentWeight +
        memoryBias.share * normalizedMemoryWeight +
        personaShare * normalizedPersonaWeight,
    );

    return { like, comment, follow, share };
  }

  async generatePathWithContext(input: BehaviorEngineInput): Promise<BehaviorPathContext> {
    const {
      persona,
      intent,
      targetId = 'post_target',
      commentContent,
      sessionId,
      usePool = true,
    } = input;

    const rnd = () => Math.random();
    const policy = await this.biasPolicy.resolvePolicy({
      tenant_id: input.tenant_id,
      template_id: input.template_id,
    });

    if (usePool && rnd() < 0.3) {
      const mutated = this.pool.sampleAndMutate(persona.persona_id);
      if (mutated) {
        return {
          path: { ...mutated, session_id: sessionId ?? mutated.session_id },
          memoryHits: 0,
          blendedBias: this.blendBias(
            intent?.action_bias,
            { like: 0.6, comment: 0.2, follow: 0.1, share: 0.1 },
            persona,
            policy.weights,
          ),
          biasPolicy: policy,
        };
      }
    }

    const memories = await this.retrieveRelevantMemories(input);
    const memoryBias = this.deriveMemoryBias(memories);
    const bias = this.blendBias(intent?.action_bias, memoryBias, persona, policy.weights);

    const doLike = rnd() < bias.like;
    const doComment = rnd() < bias.comment;
    const doFollow = rnd() < bias.follow;
    const doShare = rnd() < bias.share;

    const session_id = sessionId ?? `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const steps: BehaviorStep[] = [];

    steps.push({ action: 'open_app', delay: randomizeDelay(2, rnd) });
    steps.push({ action: 'scroll_feed', delay: 0.5, duration: randomizeDelay(6, rnd) });
    steps.push({ action: 'pause', delay: 0.3, duration: randomizeDelay(2.5, rnd) });
    steps.push({ action: 'click', delay: randomizeDelay(1, rnd), target: targetId });
    steps.push({ action: 'scroll', delay: 0.2, duration: randomizeDelay(4, rnd) });

    if (doLike) {
      steps.push({ action: 'like', delay: randomizeDelay(0.8, rnd) });
    }
    if (doComment) {
      steps.push({
        action: 'comment',
        delay: randomizeDelay(1, rnd),
        content:
          commentContent ??
          memoryBias.preferredComment ??
          '这个内容挺有意思的，蹲一个后续实测。',
      });
    }
    if (doShare) {
      steps.push({ action: 'share', delay: randomizeDelay(0.9, rnd) });
    }
    if (doFollow) {
      steps.push({ action: 'follow', delay: randomizeDelay(0.9, rnd) });
    }
    steps.push({ action: 'exit', delay: randomizeDelay(1.5, rnd) });

    return {
      path: { session_id, steps },
      memoryHits: memories.length,
      blendedBias: bias,
      biasPolicy: policy,
    };
  }

  async generatePath(input: BehaviorEngineInput): Promise<BehaviorPath> {
    const result = await this.generatePathWithContext(input);
    return result.path;
  }

  normalizeDelays(path: BehaviorPath): BehaviorPath {
    const defaults: Partial<Record<BehaviorAction, number>> = {
      open_app: 2,
      scroll_feed: 0.5,
      pause: 0.3,
      click: 1,
      scroll: 0.2,
      like: 0.8,
      comment: 1,
      share: 1,
      follow: 1,
      exit: 1.5,
    };
    return {
      ...path,
      steps: path.steps.map((s) => ({
        ...s,
        delay: s.delay ?? defaults[s.action] ?? 0.5,
      })),
    };
  }
}
