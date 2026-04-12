/**
 * Lobster Standard Operation Protocol (SOP) — 龙虾标准操作协议
 * 云端军官团下发给本地物理龙虾的「傻瓜操作包」，仅含结构化指令，无自然语言。
 */

/** 动作类型：本地龙虾可执行的原语 */
export type LobsterActionType =
  | 'LOGIN'
  | 'LOGOUT'
  | 'INPUT_TEXT'
  | 'CLICK_SELECTOR'
  | 'UPLOAD_MEDIA'
  | 'UPLOAD_VIDEO'
  | 'NAVIGATE'
  | 'WAIT'
  | 'SCROLL'
  | 'SCREENSHOT'
  | 'SYNC_CONFIG'
  | 'START_CAMPAIGN'
  | 'STOP_CAMPAIGN';

/** 平台标识 */
export type LobsterPlatform = 'xiaohongshu' | 'douyin' | 'weibo' | 'other';

/** 反检测与指纹配置（由云端下发，本地严格执行） */
export interface AntiDetectConfig {
  /** 代理 URL，如 http://user:pass@host:port */
  proxy?: string;
  /** 用户数据目录 / 指纹 ID（如 Kameleo 配置） */
  fingerprintId?: string;
  /** 是否启用真人化输入（逐字延迟、鼠标轨迹） */
  humanLikeInput?: boolean;
  /** 操作间随机延迟范围 [minMs, maxMs] */
  delayBetweenActions?: [number, number];
}

/** 单条 SOP 指令参数（按 actionType 不同而不同） */
export interface LobsterTaskParams {
  /** LOGIN: 平台 + cookie/账号标识 */
  platform?: LobsterPlatform;
  cookie_id?: string;
  /** NAVIGATE: 目标 URL */
  url?: string;
  /** INPUT_TEXT: 输入框选择器 + 文本内容 */
  selector?: string;
  text?: string;
  /** CLICK_SELECTOR: 点击目标选择器 */
  /** UPLOAD_VIDEO / UPLOAD_MEDIA: 资源 URL（OSS）与标题等 */
  file_url?: string;
  title?: string;
  description?: string;
  delay_typing?: boolean;
  /** WAIT: 等待毫秒数 */
  wait_ms?: number;
  /** 通用扩展 */
  [key: string]: unknown;
}

/**
 * LobsterTaskPayload — 云端下发给本地的单条任务包
 * 必须为结构化 JSON，本地不做语义理解，仅按 actionType + params 执行。
 */
export interface LobsterTaskPayload {
  /** 任务唯一 ID（用于进度回传与去重） */
  taskId: string;
  /** 动作类型 */
  actionType: LobsterActionType;
  /** 动作参数 */
  params: LobsterTaskParams;
  /** 反检测与指纹配置 */
  anti_detect_config?: AntiDetectConfig;
  /** 可选：所属 Campaign / 业务批次，用于战报聚合 */
  campaignId?: string;
  /** 创建时间 ISO */
  createdAt?: string;
}

/** 心跳 payload：龙虾 → 云端 */
export interface NodePingPayload {
  nodeId: string;
  status: 'IDLE' | 'BUSY';
  currentTaskId?: string;
  /** 可选：系统信息、版本号 */
  version?: string;
}

/** 任务进度：龙虾 → 云端 */
export interface TaskProgressPayload {
  taskId: string;
  nodeId: string;
  progress: number;
  message?: string;
  step?: string;
}

/** 任务完成：龙虾 → 云端 */
export interface TaskCompletedPayload {
  taskId: string;
  nodeId: string;
  success: boolean;
  result?: Record<string, unknown>;
  error?: string;
  completedAt: string;
}
