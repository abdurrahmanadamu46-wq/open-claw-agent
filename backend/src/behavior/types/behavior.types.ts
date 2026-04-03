/**
 * Behavior Engine — 行为路径数据结构
 * 输出完整行为路径（步骤序列），而非单点动作。
 * 设计见：docs/行为操作系统_设计蓝图_合规边界内.md
 */

export type BehaviorAction =
  | 'open_app'
  | 'scroll_feed'
  | 'pause'
  | 'click'
  | 'scroll'
  | 'like'
  | 'comment'
  | 'share'
  | 'follow'
  | 'exit';

export interface BehaviorStep {
  action: BehaviorAction;
  /** 执行前延迟（秒），可随机化 */
  delay?: number;
  /** 动作持续时长（秒），如 scroll/pause */
  duration?: number;
  /** 目标标识，如 post_123 */
  target?: string;
  /** 评论内容等，由 Echoer 等生成 */
  content?: string;
}

export interface BehaviorPath {
  session_id: string;
  steps: BehaviorStep[];
}

/** 行为状态机（Idle → Browse → Engage → Exit） */
export type BehaviorState = 'idle' | 'browse' | 'engage' | 'exit';
