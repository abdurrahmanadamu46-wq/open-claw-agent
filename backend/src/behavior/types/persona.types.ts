/**
 * Persona Engine — 人设数据结构
 * 用于让每个设备/会话「像一个人」，保证行为风格一致。
 * 设计见：docs/行为操作系统_设计蓝图_合规边界内.md
 */

export interface ActivityPattern {
  /** 相对活跃度 0–1 */
  morning?: number;
  afternoon?: number;
  night?: number;
}

export interface InteractionPreference {
  /** 点赞倾向 0–1 */
  like?: number;
  /** 评论倾向 0–1 */
  comment?: number;
  /** 分享倾向 0–1 */
  share?: number;
}

export interface Persona {
  persona_id: string;
  age?: number;
  gender?: 'male' | 'female' | 'other';
  city?: string;
  interests: string[];
  /** 活跃时段权重 */
  activity_pattern?: ActivityPattern;
  /** 互动激进程度 0–1 */
  aggressiveness?: number;
  /** 互动类型偏好 */
  interaction_preference?: InteractionPreference;
}
