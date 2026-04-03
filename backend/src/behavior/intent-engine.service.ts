/**
 * Intent Engine — 动机生成（规则 + 标签匹配）
 * 决定「为什么做这个行为」，输出动作偏好。
 */
import { Injectable } from '@nestjs/common';
import type { Persona } from './types/persona.types';
import type { IntentOutput, ActionBias } from './types/intent.types';

export interface IntentInput {
  persona: Persona;
  /** 内容标签（如 ['美妆', '口红']） */
  contentTags: string[];
  /** 当前任务目标（如 'engage_with_content' | 'discover_feed'） */
  goal?: string;
}

@Injectable()
export class IntentEngineService {
  /**
   * 根据人设、内容特征、目标生成意图与动作偏好。
   */
  resolve(input: IntentInput): IntentOutput {
    const { persona, contentTags, goal = 'engage_with_content' } = input;
    const interestSet = new Set(persona.interests);
    const matchCount = contentTags.filter((t) => interestSet.has(t)).length;
    const confidence = contentTags.length === 0 ? 0.5 : Math.min(0.95, 0.3 + (matchCount / contentTags.length) * 0.6);

    let intent = 'browsing';
    if (confidence > 0.6) intent = 'interested_in_product';
    else if (confidence > 0.4) intent = 'curious';
    if (goal === 'discover_feed') intent = 'discover_feed';

    const like = (persona.interaction_preference?.like ?? 0.6) * (0.7 + confidence * 0.3);
    const comment = (persona.interaction_preference?.comment ?? 0.2) * (0.5 + confidence * 0.5);
    const follow = 0.1 + confidence * 0.3;
    const share = (persona.interaction_preference?.share ?? 0.1) * confidence;
    const sum = like + comment + follow + share;
    const action_bias: ActionBias = {
      like: like / sum,
      comment: comment / sum,
      follow: follow / sum,
      share: share / sum,
    };

    return {
      intent,
      confidence,
      action_bias,
    };
  }
}
