/**
 * ClawCommerce 数据字典约定 - 双端必须严格遵守
 * 来源：PM 文档 v1.3 研发协同协议 & 第一阶段双端开发任务书
 * @module shared/contracts
 */

/**
 * Agent 节点状态枚举（与后端 Entity 一致，禁止越权流转）
 */
export enum NodeStatusEnum {
  IDLE = 'IDLE',
  /** 正在拉起环境/指纹 */
  INITIALIZING = 'INIT',
  /** 正在采集对标 */
  SCRAPING = 'SCRAPING',
  /** 正在二创渲染 */
  GENERATING = 'GENERATING',
  /** 正在发布 */
  PUBLISHING = 'PUBLISHING',
  /** 风控冷却中 */
  COOLING = 'COOLING',
  /** 账号/IP 被封禁 */
  BANNED = 'BANNED',
}

/**
 * Campaign 配置契约（后端 BullMQ 下发给 Agent 的 job payload）
 * Sprint 2：增加 content_strategy 弹性分镜区间，与后端 CampaignService 双端同步。
 */
export interface ICampaignConfig {
  campaign_id: string;
  tenant_id: string;
  industry_template_id: string;
  /** 必须验证: 长度 1-20，合法 URL */
  target_urls: string[];
  /** Sprint 2 弹性分镜：模板类型 + min/max_clips 区间（后端从 TEMPLATE_DYNAMIC_RULES 写入） */
  content_strategy?: {
    template_type: string;
    min_clips: number;
    max_clips: number;
  };
  /** 兼容旧版 */
  publish_strategy?: {
    daily_limit: number;
    active_hours: string[];
  };
  /** 物理节点上绑定的平台账号 ID */
  bind_accounts: string[];
  /** 线索回传地址 */
  webhook_url?: string;
}

/** BullMQ campaign-queue job data 形状 */
export interface CampaignJobData {
  type: 'START_SCRAPING' | 'GENERATE_VIDEO' | 'PUBLISH_CONTENT';
  payload: ICampaignConfig;
  jobId: string;
  tenantId: string;
}

/** Agent 上报给后端的节点心跳 payload */
export interface NodeHeartbeatPayload {
  nodeId: string;
  status: NodeStatusEnum;
  cpuPercent?: number;
  memoryMb?: number;
  browserHealthy: boolean;
  lastHeartbeatAt: string;
}

/**
 * 线索回传契约：Agent 零数据落盘权，只负责把「原始线索」POST 到后端。
 * 后端负责：强校验、AES 加密落库、租户归属、去重、入 lead-webhook-queue 推送 CRM。
 * 与后端 CreateInternalLeadDto 对齐：含 source_platform、raw_context。
 */
export interface ILeadSubmissionPayload {
  tenant_id: string;
  campaign_id: string;
  /** 原始联系方式（后端加密后存 lead.contact_info） */
  contact_info: string;
  /** AI 意向度 0-100 */
  intention_score: number;
  /** 抓取到的平台：douyin | xiaohongshu | kuaishou 等（后端必填 source_platform） */
  source_platform?: string;
  /** 抓取到的原始上下文凭证（JSON/文本） */
  raw_context?: string;
  /** 来源：comment | dm | form（兼容旧字段） */
  source?: string;
  /** 扩展字段（后端可做字段映射） */
  extra?: Record<string, unknown>;
}

/**
 * PM v1.8 动态分镜规则配置表（双端同步）
 * 取消固定 5/7/15 分镜，改为弹性区间；语意边界 + 物理字数/时长校验在 Agent 侧完成。
 */
export const TEMPLATE_DYNAMIC_RULES: Record<string, { min_clips: number; max_clips: number }> = {
  '10秒爆款短视频': { min_clips: 3, max_clips: 6 },
  '15秒故事带货': { min_clips: 5, max_clips: 9 },
  '30秒深度种草': { min_clips: 10, max_clips: 18 },
};

/**
 * OpenClaw 边缘节点任务步 — 原生动作 + 自定义指令 (custom_script)
 * 通过 WebSocket server.task.dispatch 下发的 steps 数组，支持“无限手套”扩展
 */
export type OpenClawTaskStep =
  | { action: 'click'; selector?: string; x?: number; y?: number }
  | { action: 'type'; selector?: string; text: string }
  | { action: 'scroll'; deltaY?: number }
  | { action: 'navigate'; url: string }
  | {
      action: 'custom_script';
      /** 客户上传的 JS 代码片段，在沙盒内执行（Playwright/Node 环境） */
      script: string;
      /** 超时毫秒，默认 30000 */
      timeoutMs?: number;
      /** 可选：脚本可接收的 JSON 上下文（只读） */
      context?: Record<string, unknown>;
    };

/**
 * 下发给龙虾/Agent 的完整任务负载（含自定义指令通道）
 */
export interface OpenClawTaskPayload {
  job_id: string;
  campaign_id: string;
  action: string;
  config?: ICampaignConfig;
  /** 顺序执行的动作步；含 custom_script 时由节点沙盒执行 */
  steps?: OpenClawTaskStep[];
}
