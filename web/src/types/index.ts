/**
 * 云端 SaaS 集中管理远端 OpenClaw 节点 — 类型定义
 * 业务模式：设备与节点大盘、一对多任务下发、节点绑定与授权（Provisioning）
 */

/** 远端节点在线状态：在线 / 离线 / 忙碌 / 风控熔断（需人机接管） */
export type RemoteNodeStatus = 'ONLINE' | 'OFFLINE' | 'BUSY' | 'INTERVENTION_REQUIRED';

/** 当前节点上运行的平台标识（社交通道 / 自动化通道） */
export type RemoteNodePlatform = 'whatsapp' | 'wechat' | 'douyin' | 'telegram' | 'chrome' | 'other';

/**
 * 远端设备系统指标
 * - 用于「龙虾池」卡片上的 CPU/内存负荷条与告警
 */
export interface RemoteNodeSystemMetrics {
  /** CPU 使用率 0–100 */
  cpuPercent: number;
  /** 内存占用百分比 0–100 */
  memoryPercent: number;
  /** 当前正在运行/挂载的平台（用于展示图标） */
  platforms: RemoteNodePlatform[];
}
export * from './autonomy-policy';
export * from './edge-terminal';
export * from './execution-monitor';
export * from './edge-node-group';
export * from './memory-compression';
export * from './session-isolation';
export * from './skill-effectiveness';
export * from './strategy-intensity';

/**
 * RemoteNode — 远端节点（一台客户电脑上的 OpenClaw 工作节点）
 * 对应「设备与节点大盘」里的单台机器卡片数据源
 */
export interface RemoteNode {
  /** 节点唯一 ID（与 Agent 池内 nodeId 对齐） */
  nodeId: string;
  /** 所属客户/租户 ID，用于多租户隔离与授权 */
  clientId: string;
  /** 工作空间/租户 ID，多租户隔离（与 Tenant 切换器对应） */
  tenantId?: string;
  /** 客户展示名（卡片标题） */
  clientName: string;
  /** 在线状态 */
  status: RemoteNodeStatus;
  /** 最后心跳时间 ISO8601；超过阈值可视为离线告警 */
  lastPingAt: string;
  /** 系统负荷与当前运行平台 */
  systemMetrics: RemoteNodeSystemMetrics;
  /** 当前占用的任务/账号摘要（可选，用于运维快速识别） */
  currentAccountSummary?: string;
  /** 风控熔断原因（如平台人脸验证、滑块验证失败等，仅当 status === INTERVENTION_REQUIRED 时有效） */
  circuitBreakerReason?: string;
  /** 本地离线缓存状态 */
  metaCacheStatus?: string;
  /** 期望状态与实际状态是否已对齐 */
  twinSynced?: boolean;
  /** 待同步的配置变更数 */
  pendingConfigUpdates?: number;
  /** 待同步的技能变更数 */
  pendingSkillUpdates?: number;
  /** 本地待执行任务数 */
  pendingTaskCount?: number;
  /** 本地运行中任务数 */
  runningTaskCount?: number;
  /** 最大并发任务数 */
  maxConcurrentTasks?: number;
  /** 当前日志等级 */
  logLevel?: string;
  /** 边缘运行时版本 */
  edgeVersion?: string;
  /** 云端期望版本 */
  desiredResourceVersion?: number;
  /** 边缘已应用版本 */
  actualResourceVersion?: number;
  /** 配置版本摘要 */
  configVersionSummary?: string;
  /** 技能版本摘要 */
  skillVersionSummary?: string;
  /** 节点所属分组 ID */
  groupId?: string;
  /** 节点所属分组名称 */
  groupName?: string;
}

/** 下发到远端的动作类型 */
export type TaskCommandActionType =
  | 'START_CAMPAIGN'
  | 'STOP_CAMPAIGN'
  | 'RESTART_AGENT'
  | 'SYNC_CONFIG'
  | 'PROVISION_ACK';

/** 指令生命周期：待发送 → 已发送 → 对端已确认 → 已完成 */
export type TaskCommandStatus = 'PENDING' | 'SENT' | 'ACKNOWLEDGED' | 'COMPLETED';

/**
 * TaskCommand — 远端下发指令（集中下发中心的一条记录）
 * 用于「一对多任务下发」与审计回执
 */
export interface TaskCommand {
  /** 指令唯一 ID */
  commandId: string;
  /** 目标节点 ID */
  targetNodeId: string;
  /** 动作类型 */
  actionType: TaskCommandActionType;
  /** 具体任务数据（Campaign 配置、terminate 参数等，后端/Agent 解析） */
  payload: Record<string, unknown>;
  /** 指令状态 */
  status: TaskCommandStatus;
  /** 创建时间 */
  createdAt: string;
  /** 对端确认时间（可选） */
  acknowledgedAt?: string;
}

/** 节点绑定码（Provisioning Token）— 客户在本地 OpenClaw 输入后自动接入 SaaS */
export interface ProvisioningToken {
  /** 绑定码字符串（短码或 JWT 片段，由后端生成） */
  token: string;
  /** 过期时间 */
  expiresAt: string;
  /** 已绑定 nodeId（未绑定前为空） */
  boundNodeId?: string;
}

export * from './voice';
