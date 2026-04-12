/**
 * LangGraph 多智能体工作流 — 全局图状态与分镜契约
 * 与 shared/contracts 弹性分镜规则、OpenClawTaskPayload 对齐
 */

/** 单条分镜（按语意断句的一镜） */
export interface DraftScriptScene {
  /** 镜号，从 1 开始 */
  index: number;
  /** 该镜文案/旁白（语意完整的一句或一段） */
  text: string;
  /** 可选：类型/用途标记，如 hook / pain_point / cta */
  type?: string;
}

/** 编导 Agent 输出的分镜脚本 JSON 结构 */
export interface DraftScript {
  /** 模板类型，与 TEMPLATE_DYNAMIC_RULES 的 key 对应 */
  template_type?: string;
  /** 分镜列表，按语意断句、顺序执行 */
  scenes: DraftScriptScene[];
}

/** 侦察 Agent 输出的竞品情报（结构化） */
export interface CompetitorData {
  /** 核心钩子/卖点摘要 */
  hooks?: string[];
  /** 用户痛点/需求点 */
  pain_points?: string[];
  /** 原始摘要或备注 */
  summary?: string;
  [key: string]: unknown;
}

/** 下发给客户端的最终指令（与 OpenClaw 契约兼容） */
export interface FinalActionPayload {
  job_id: string;
  campaign_id: string;
  action: string;
  /** 顺序执行的动作步，含 custom_script 等 */
  steps?: Array<{
    action: string;
    script?: string;
    text?: string;
    selector?: string;
    url?: string;
    context?: Record<string, unknown>;
    timeoutMs?: number;
    [key: string]: unknown;
  }>;
  config?: Record<string, unknown>;
}

/**
 * 图中流转的共享状态（Manus 级多脑协同）
 */
export interface AgentWorkflowState {
  tenantId: string;
  /** 用户原始目标/任务描述 */
  rawTaskInput: string;
  /** 侦察 Agent 抓取到的结构化情报 */
  competitorData: CompetitorData | null;
  /** 编导 Agent 生成的初稿分镜 JSON */
  draftScript: DraftScript | null;
  /** 流转中的报错，用于触发纠错重试 */
  errorLog: string[];
  /** Director 重试次数（用于最多 3 次重试） */
  directorRetryCount: number;
  /** 最终下发给客户端的指令 */
  finalActionPayload: FinalActionPayload | null;
  /** 仅图内使用：Director 输出格式校验是否通过 */
  validationPassed?: boolean;
}

export const MAX_DIRECTOR_RETRIES = 3;
