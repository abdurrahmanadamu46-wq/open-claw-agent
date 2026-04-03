/**
 * 弹性记忆模块 — 类型定义
 * 与 Python LobsterMemoryEngine / FastAPI 契约一致
 */

export interface StoreExperiencePayload {
  node_id: string;
  intent: string;
  context_data: Record<string, unknown>;
  reward: number;
  persona_id?: string;
}

export interface StoreExperienceResponse {
  point_id: string;
  message: string;
}

export interface RetrieveMemoryPayload {
  node_id: string;
  current_task: string;
  top_k?: number;
  persona_id?: string;
}

export interface MemoryItemPayload {
  node_id: string;
  intent: string;
  context_data: Record<string, unknown>;
  reward: number;
  timestamp: number;
  persona_id?: string;
}

export interface MemoryItem {
  final_score: number;
  memory_details: MemoryItemPayload;
}

export interface RetrieveMemoryResponse {
  memories: MemoryItem[];
}
