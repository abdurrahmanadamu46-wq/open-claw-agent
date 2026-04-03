/**
 * 行为调度 payload：下发到边缘的是 Persona + Intent + BehaviorPath，而非单任务。
 */
import type { Persona } from './types/persona.types';
import type { IntentOutput } from './types/intent.types';
import type { BehaviorPath } from './types/behavior.types';

export interface BehaviorSessionPayload {
  session_id: string;
  tenant_id: string;
  trace_id?: string;
  campaign_id?: string;
  /** 目标节点 id（可选，由调度器指定） */
  node_id?: string;
  persona: Persona;
  intent?: IntentOutput;
  behavior_path: BehaviorPath;
  /** 创建时间 */
  created_at: string;
}
