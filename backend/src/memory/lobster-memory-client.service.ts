/**
 * LobsterMemoryEngine 客户端 — 调用 Python 弹性记忆微服务
 * 供 Intent / Behavior Engine 写入经历与检索自适应记忆，提升拟人度与连贯性
 */
import { Injectable, Logger } from '@nestjs/common';
import type {
  StoreExperiencePayload,
  StoreExperienceResponse,
  RetrieveMemoryPayload,
  RetrieveMemoryResponse,
} from './memory.types';

const DEFAULT_MEMORY_BASE_URL = 'http://localhost:8000';

@Injectable()
export class LobsterMemoryClientService {
  private readonly logger = new Logger(LobsterMemoryClientService.name);
  private readonly baseUrl: string;

  constructor() {
    this.baseUrl = process.env.LOBSTER_MEMORY_BASE_URL ?? DEFAULT_MEMORY_BASE_URL;
  }

  /** 是否配置了记忆服务（未配置时调用不报错，仅跳过） */
  isConfigured(): boolean {
    return !!process.env.LOBSTER_MEMORY_BASE_URL || this.baseUrl === DEFAULT_MEMORY_BASE_URL;
  }

  /**
   * 写入一条经历（边缘节点执行后的结果 → 记忆引擎）
   */
  async storeExperience(payload: StoreExperiencePayload): Promise<StoreExperienceResponse | null> {
    try {
      const res = await fetch(`${this.baseUrl}/memory/store`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        this.logger.warn(`[Memory] store_experience failed: ${res.status} ${await res.text()}`);
        return null;
      }
      return (await res.json()) as StoreExperienceResponse;
    } catch (e) {
      this.logger.warn(`[Memory] store_experience error: ${(e as Error).message}`);
      return null;
    }
  }

  /**
   * 检索自适应记忆（Intent/Behavior Engine 下发任务前调用，注入「潜意识」）
   */
  async retrieveAdaptiveMemory(
    payload: RetrieveMemoryPayload,
  ): Promise<RetrieveMemoryResponse['memories']> {
    try {
      const res = await fetch(`${this.baseUrl}/memory/retrieve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          node_id: payload.node_id,
          current_task: payload.current_task,
          top_k: payload.top_k ?? 5,
          persona_id: payload.persona_id,
        }),
      });
      if (!res.ok) {
        this.logger.warn(`[Memory] retrieve failed: ${res.status} ${await res.text()}`);
        return [];
      }
      const data = (await res.json()) as RetrieveMemoryResponse;
      return data.memories ?? [];
    } catch (e) {
      this.logger.warn(`[Memory] retrieve error: ${(e as Error).message}`);
      return [];
    }
  }

  async health(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`);
      return res.ok;
    } catch {
      return false;
    }
  }
}
