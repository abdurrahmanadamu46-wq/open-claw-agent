/**
 * 提线木偶协议 (Marionette Protocol) — 高级虾 → 干活虾 的「行动准考证」
 *
 * 云端 AI 数字内阁（高级龙虾）只有「脑子」没有「手脚」；
 * 客户本地的物理龙虾（干活龙虾）只有「手脚」没有「脑子」。
 * 本协议是二者之间的加密语言：云端下发结构化 SOP 指令包，本地严格按步执行并回传。
 *
 * 协议版本：marionette/v1
 */

/** 云端内阁身份（谁下的指令） */
export type MarionetteCabinetId =
  | 'algorithm_scheduler'   // 📅 算法排期官
  | 'golden_scriptwriter'   // 🎣 黄金编剧
  | 'visual_director'       // 🎨 视觉导演
  | 'conversion_hacker'      // 🐺 转化黑客
  | 'sales_champion'        // ☎️ 金牌销冠
  | 'trend_radar';          // 🎬 爆款雷达

/** 单步动作类型（干活虾可执行的原语） */
export type MarionetteStepAction =
  | 'DOWNLOAD_ASSET'        // 从云端 CDN 下载素材到本地
  | 'NAVIGATE'              // 打开指定 URL / 平台首页
  | 'INPUT_TEXT'            // 在指定输入框内以「真人速度」输入文案
  | 'UPLOAD_VIDEO'          // 上传本地视频文件到当前页面
  | 'UPLOAD_IMAGE'          // 上传图片
  | 'CLICK_SELECTOR'        // 点击按钮/链接（选择器）
  | 'WAIT'                  // 等待 N 毫秒（模拟人类停顿）
  | 'SCROLL'                // 滚动页面
  | 'SCREENSHOT'            // 截屏并回传
  | 'GRAB_SOURCE'           // 抓取当前页源码/链接（战前侦察用）
  | 'REPORT_BACK';          // 主动回传一条战报给云端

/** 单步参数（按 action 不同而不同） */
export interface MarionetteStepParams {
  // DOWNLOAD_ASSET
  asset_url?: string;
  save_as?: string;

  // NAVIGATE
  url?: string;
  platform?: 'xiaohongshu' | 'douyin' | 'kuaishou' | 'weibo';

  // INPUT_TEXT
  selector?: string;
  text?: string;
  /** 本步覆盖：打字速度（字/分钟），不填则用 packet.humanLike.typingCharsPerMinute */
  typing_chars_per_minute?: number;

  // UPLOAD_VIDEO / UPLOAD_IMAGE
  file_path?: string;       // 本地路径（由 DOWNLOAD_ASSET 得到）
  title?: string;
  description?: string;

  // CLICK_SELECTOR
  // selector 见上

  // WAIT
  wait_ms?: number;

  // SCROLL
  delta_y?: number;
  count?: number;

  // SCREENSHOT
  name?: string;

  // GRAB_SOURCE
  extract?: 'links' | 'metrics' | 'full_html';

  // REPORT_BACK
  message?: string;
  result?: Record<string, unknown>;

  [key: string]: unknown;
}

/** 单条 SOP 步骤 */
export interface MarionetteSopStep {
  step_id: string;
  action: MarionetteStepAction;
  params: MarionetteStepParams;
  /** 可选：本步失败时是否允许继续（默认 false = 中断并上报） */
  optional?: boolean;
}

/** 真人化行为配置（反检测、拟人） */
export interface HumanLikeBehavior {
  /** 打字速度：字/分钟（如 60 = 每分钟 60 字，慢速更像真人） */
  typingCharsPerMinute: number;
  /** 步骤之间随机延迟 [minMs, maxMs] */
  delayBetweenActionsMs: [number, number];
  /** 是否启用鼠标轨迹随机化 */
  humanLikeMouse?: boolean;
}

/** 回传要求 */
export interface ReportBackPolicy {
  onSuccess: boolean;
  onFailure: boolean;
  /** 需要截屏的步骤 step_id 列表，如 ["final", "after_publish"] */
  screenshots?: string[];
}

/**
 * 提线木偶协议 — 行动准考证（完整 SOP 指令包）
 * 由云端「算法排期官」等内阁生成，通过 WebSocket execute_task 下发给指定 nodeId 的干活虾。
 */
export interface MarionetteSopPacket {
  /** 协议标识，固定 "marionette/v1" */
  protocol: 'marionette/v1';
  /** 任务唯一 ID（进度回传、去重） */
  taskId: string;
  /** 业务批次/战役 ID */
  campaignId?: string;
  /** 下发方：哪个 AI 内阁 */
  fromCabinet: MarionetteCabinetId;
  /** 执行方：哪只物理龙虾（nodeId） */
  targetNodeId: string;
  /** 计划执行时间（ISO 8601），干活虾到点再执行 */
  scheduledAt: string;
  /** 真人化参数（本地严格执行） */
  humanLike: HumanLikeBehavior;
  /** 顺序执行步骤（提线木偶的「动作序列」） */
  steps: MarionetteSopStep[];
  /** 回传策略 */
  reportBack: ReportBackPolicy;
  /** 创建时间 ISO */
  createdAt?: string;
}
